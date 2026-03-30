export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/translate") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders()
        });
      }

      if (request.method !== "POST") {
        return json({ error: { message: "Method not allowed." } }, 405);
      }

      return handleTranslate(request, env);
    }

    if (url.pathname === "/api/records") {
      if (request.method !== "GET") {
        return json({ error: { message: "Method not allowed." } }, 405);
      }

      return handleListRecords(env);
    }

    const likeMatch = url.pathname.match(/^\/api\/records\/(\d+)\/like$/);
    if (likeMatch) {
      if (request.method !== "POST") {
        return json({ error: { message: "Method not allowed." } }, 405);
      }

      return handleLikeRecord(env, Number(likeMatch[1]));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (
      request.method === "GET" &&
      assetResponse.status === 404 &&
      !url.pathname.startsWith("/api/")
    ) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    return assetResponse;
  }
};

async function handleTranslate(request, env) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return json({ error: { message: "请求里缺少 text 字段。" } }, 400);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: { message: "服务端没有配置 OPENAI_API_KEY。" } }, 500);
    }

    const model = env.OPENAI_MODEL || "glm-5";
    const apiBaseUrl = env.OPENAI_API_BASE_URL || "https://open.bigmodel.cn/api/paas";
    const chatCompletionsPath = env.OPENAI_CHAT_COMPLETIONS_PATH || "/v4/chat/completions";
    const chatCompletionsUrl = buildApiUrl(apiBaseUrl, chatCompletionsPath);

    const upstreamResponse = await fetch(chatCompletionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are an English writing assistant and translator.",
              "Detect whether the user's input is primarily English.",
              "If the input is primarily English:",
              "- correct grammar, spelling, and punctuation while preserving meaning",
              "- also provide a second version that sounds more natural and idiomatic",
              "- also provide a third version that sounds more conversational and spoken",
              "- return mode as english",
              "If the input is not primarily English:",
              "- translate it into natural, idiomatic English",
              "- return mode as translation",
              "Return valid JSON only with this exact schema:",
              "{",
              '  "mode": "english" | "translation",',
              '  "translation": string,',
              '  "corrected": string,',
              '  "polished": string,',
              '  "colloquial": string',
              "}",
              "For translation mode, fill translation and leave corrected, polished, and colloquial as empty strings.",
              "For english mode, fill corrected, polished, and colloquial, and leave translation as an empty string.",
              "Do not wrap JSON in markdown."
            ].join("\n")
          },
          {
            role: "user",
            content: text
          }
        ],
        stream: false,
        temperature: 0.2
      })
    });

    const responseText = await upstreamResponse.text();
    const data = safeJsonParse(responseText);

    if (!upstreamResponse.ok) {
      const code = data?.error?.code || "";
      const type = data?.error?.type || "";
      const upstreamMessage = data?.error?.message || responseText.slice(0, 300) || "Upstream AI request failed.";
      const friendlyMessage = formatProviderError(upstreamResponse.status, code, type, upstreamMessage);

      return json(
        {
          error: {
            message: friendlyMessage,
            code,
            type,
            upstream_message: upstreamMessage
          }
        },
        upstreamResponse.status
      );
    }

    const rawContent = data?.choices?.[0]?.message?.content?.trim();
    const result = safeJsonParse(rawContent);
    const mode = result?.mode;
    const translation = result?.translation?.trim() || "";
    const corrected = result?.corrected?.trim() || "";
    const polished = result?.polished?.trim() || "";
    const colloquial = result?.colloquial?.trim() || "";

    if (!mode || (mode === "translation" && !translation) || (mode === "english" && !corrected && !polished && !colloquial)) {
      return json({ error: { message: "模型没有返回可用结果。" } }, 502);
    }

    const recordId = await saveRecordIfPossible(env, {
      sourceText: text.trim(),
      mode,
      translation,
      corrected,
      polished,
      colloquial
    });

    return json(
      {
        mode,
        translation,
        corrected,
        polished,
        colloquial,
        model,
        api_base_url: apiBaseUrl,
        chat_completions_path: chatCompletionsPath,
        chat_completions_url: chatCompletionsUrl,
        record_id: recordId
      },
      200
    );
  } catch (error) {
    return json({ error: { message: error?.message || "服务端处理失败。" } }, 500);
  }
}

async function handleListRecords(env) {
  if (!env.TRANSLATIONS_DB) {
    return json({ error: { message: "服务端没有配置 TRANSLATIONS_DB。" } }, 500);
  }

  try {
    const { results } = await env.TRANSLATIONS_DB.prepare(
      `SELECT id, source_text, mode, translation, corrected, polished, colloquial, likes_count, created_at
       FROM translation_records
       ORDER BY id DESC
       LIMIT 100`
    ).all();

    return json({ records: results || [] }, 200);
  } catch (error) {
    return json({ error: { message: formatDatabaseErrorMessage(error) } }, 500);
  }
}

async function handleLikeRecord(env, recordId) {
  if (!env.TRANSLATIONS_DB) {
    return json({ error: { message: "服务端没有配置 TRANSLATIONS_DB。" } }, 500);
  }

  try {
    const updated = await env.TRANSLATIONS_DB.prepare(
      `UPDATE translation_records
       SET likes_count = likes_count + 1
       WHERE id = ?`
    )
      .bind(recordId)
      .run();

    if (!updated.meta?.changes) {
      return json({ error: { message: "记录不存在。" } }, 404);
    }

    const record = await env.TRANSLATIONS_DB.prepare(
      `SELECT id, likes_count
       FROM translation_records
       WHERE id = ?`
    )
      .bind(recordId)
      .first();

    return json({ record }, 200);
  } catch (error) {
    return json({ error: { message: formatDatabaseErrorMessage(error) } }, 500);
  }
}

async function saveRecordIfPossible(env, record) {
  if (!env.TRANSLATIONS_DB) {
    return null;
  }

  const result = await env.TRANSLATIONS_DB.prepare(
    `INSERT INTO translation_records
      (source_text, mode, translation, corrected, polished, colloquial)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      record.sourceText,
      record.mode,
      record.translation,
      record.corrected,
      record.polished,
      record.colloquial
    )
    .run();

  return result.meta?.last_row_id ?? null;
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function safeJsonParse(text) {
  if (!text) {
    return null;
  }

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function formatProviderError(status, code, type, upstreamMessage) {
  if (code === "insufficient_quota") {
    return "AI API quota exceeded. Please check billing and available credits.";
  }

  if (status === 401) {
    return "AI API key is invalid or missing.";
  }

  if (status === 429) {
    return "AI API rate limit reached. Please retry in a moment.";
  }

  if (status >= 500) {
    return "AI service is temporarily unavailable. Please try again later.";
  }

  if (type || code || upstreamMessage) {
    return `AI provider error: ${upstreamMessage}`;
  }

  return "AI request failed.";
}

function formatDatabaseErrorMessage(error) {
  const message = error?.message || "数据库操作失败。";

  if (/no such table/i.test(message) || /translation_records/i.test(message)) {
    return "翻译记录表还没有创建。请先运行 D1 migration。";
  }

  return `数据库错误：${message}`;
}

function buildApiUrl(baseUrl, path) {
  const normalizedBase = (baseUrl || "").replace(/\/+$/, "");
  const normalizedPath = `/${(path || "").replace(/^\/+/, "")}`;

  if (normalizedBase.endsWith("/v4") && normalizedPath.startsWith("/v4/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  if (normalizedBase.endsWith("/api/paas/v4") && normalizedPath.startsWith("/v4/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}
