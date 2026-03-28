export async function onRequestPost(context) {
  const corsHeaders = {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    const { request, env } = context;
    const { text } = await request.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return json(
        { error: { message: "请求里缺少 text 字段。" } },
        400,
        corsHeaders
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { error: { message: "服务端没有配置 OPENAI_API_KEY。" } },
        500,
        corsHeaders
      );
    }

    const model = env.OPENAI_MODEL || "gpt-4o-mini";
    const apiBaseUrl = (env.OPENAI_API_BASE_URL || "https://api.chatanywhere.tech").replace(/\/+$/, "");

    const openaiResponse = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
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
            content:
              [
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
                "For translation mode, fill translation and leave corrected/polished/colloquial as empty strings.",
                "For english mode, fill corrected, polished, and colloquial, and leave translation as empty string.",
                "Do not wrap JSON in markdown."
              ].join("\n")
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.2
      })
    });

    const responseText = await openaiResponse.text();
    const data = safeJsonParse(responseText);

    if (!openaiResponse.ok) {
      const code = data?.error?.code || "";
      const type = data?.error?.type || "";
      const upstreamMessage = data?.error?.message || "Upstream AI request failed.";
      const friendlyMessage = formatOpenAIErrorMessage(
        openaiResponse.status,
        code,
        type,
        upstreamMessage
      );

      return json(
        {
          error: {
            message: friendlyMessage,
            code,
            type,
            upstream_message: upstreamMessage
          }
        },
        openaiResponse.status,
        corsHeaders
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
      return json(
        { error: { message: "模型没有返回可用结果。" } },
        502,
        corsHeaders
      );
    }

    return json(
      {
        mode,
        translation,
        corrected,
        polished,
        colloquial,
        model,
        api_base_url: apiBaseUrl
      },
      200,
      corsHeaders
    );
  } catch (error) {
    return json(
      { error: { message: error?.message || "服务端处理失败。" } },
      500,
      corsHeaders
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatOpenAIErrorMessage(status, code, type, upstreamMessage) {
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
