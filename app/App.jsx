import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import PwaInstallButton from "./PwaInstallButton.jsx";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "i", "if", "in", "into", "is", "it",
  "its", "me", "my", "of", "on", "or", "our", "she", "that", "the", "their",
  "them", "there", "they", "this", "to", "us", "was", "we", "were", "will",
  "with", "you", "your"
]);

function App() {
  return (
    <Routes>
      <Route path="/" element={<TranslatorPage />} />
      <Route path="/records" element={<RecordsPage />} />
    </Routes>
  );
}

function TranslatorPage() {
  const [sourceText, setSourceText] = useState("");
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [result, setResult] = useState(createEmptyResult());

  const keywords = useMemo(() => extractKeywords(getBestEnglishResult(result)), [result]);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  function clearResult(message = "翻译结果会显示在这里。") {
    setResult(createEmptyResult(message));
  }

  async function runTranslation(text, pendingStatus) {
    const value = text.trim();
    if (!value) {
      throw new Error("请输入要处理的内容。");
    }

    setSourceText(value);
    setSavedNote("");
    setStatus(pendingStatus);
    setStatusIsError(false);
    setResult(createEmptyResult("AI 正在处理，请稍候..."));

    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: value })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || "调用 AI 接口失败。");
    }

    setResult({
      mode: data?.mode || "translation",
      translation: data?.translation?.trim() || "",
      corrected: data?.corrected?.trim() || "",
      polished: data?.polished?.trim() || "",
      colloquial: data?.colloquial?.trim() || "",
      message: ""
    });
    setStatus("处理完成。");

    if (data?.record_id) {
      const totalMs = data?.timings?.total_ms ? `，耗时 ${data.timings.total_ms}ms` : "";
      setSavedNote(`已保存到翻译记录 #${data.record_id}${totalMs}。`);
    } else {
      setSavedNote("本次结果未保存，请检查服务端是否绑定了 D1 数据库。");
    }
  }

  async function handlePasteAndTranslate() {
    if (!navigator.clipboard?.readText) {
      setStatus("当前浏览器不支持读取剪贴板。");
      setStatusIsError(true);
      return;
    }

    setIsWorking(true);
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        throw new Error("剪贴板里没有可用文本。");
      }

      await runTranslation(clipboardText, "正在读取剪贴板并交给 AI 处理...");
    } catch (error) {
      clearResult("暂时无法显示结果。");
      setSavedNote("");
      setStatus(error.message || "处理失败，请稍后再试。");
      setStatusIsError(true);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDirectTranslate() {
    setIsWorking(true);
    try {
      await runTranslation(sourceText, "正在处理当前输入内容...");
    } catch (error) {
      clearResult("暂时无法显示结果。");
      setSavedNote("");
      setStatus(error.message || "处理失败，请稍后再试。");
      setStatusIsError(true);
    } finally {
      setIsWorking(false);
    }
  }

  function handleClear() {
    setSourceText("");
    setSavedNote("");
    setStatus("");
    setStatusIsError(false);
    clearResult();
  }

  const isEnglishMode = result.mode === "english";
  const mainText = result.translation || result.message;

  return (
    <AppFrame>
      <TopBar
        left={
          <Link className="brand" to="/">
            <span className="brand-mark">NE</span>
            <span className="brand-copy">
              <span className="brand-text">Native English</span>
              <span className="brand-subtitle">Installable Web App</span>
            </span>
          </Link>
        }
        right={
          <div className="topbar-actions">
            <PwaInstallButton />
            <Link className="topbar-action" to="/records">翻译记录</Link>
          </div>
        }
      />

      <main className="page-shell">
        <section className="content-card">
          <header className="hero">
            <h1>像原生 App 一样使用你的翻译工具</h1>
            <p>
              支持安装到桌面或手机主屏、粘贴翻译、英文纠错、地道润色、口语化改写、
              发音、复制和翻译记录同步浏览。
            </p>
          </header>

          <section className="section">
            <label htmlFor="sourceText">输入内容</label>
            <div className="input-wrap">
              <textarea
                id="sourceText"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="可以直接输入，也可以点击下方按钮读取剪贴板内容。"
              />
              {sourceText.trim() ? (
                <button
                  type="button"
                  className="clear-inline"
                  aria-label="清空输入框"
                  onClick={handleClear}
                >
                  ×
                </button>
              ) : null}
            </div>
          </section>

          <section className="actions">
            <div className="button-row">
              <button type="button" onClick={handlePasteAndTranslate} disabled={isWorking}>点击粘贴</button>
              <button type="button" onClick={handleDirectTranslate} disabled={isWorking}>直接翻译</button>
            </div>
            <div className={`status ${statusIsError ? "error" : ""}`}>{status}</div>
            <div className="saved-note">{savedNote}</div>
          </section>

          <section className="result-panel">
            <div className="panel-title">处理结果</div>

            {!isEnglishMode ? (
              <>
                <div className="output">{mainText || "结果会显示在这里。"}</div>
                <div className="result-actions">
                  <IconButton
                    label="播放读音"
                    onClick={() => speakText(mainText)}
                    disabled={!mainText.trim()}
                  >
                    <PlayIcon />
                  </IconButton>
                  <IconButton
                    label="复制结果"
                    onClick={() => copyText(mainText, setStatus, setStatusIsError)}
                    disabled={!mainText.trim()}
                  >
                    <CopyIcon />
                  </IconButton>
                </div>
              </>
            ) : (
              <div className="result-stack">
                <ResultCard
                  title="语法纠正"
                  text={result.corrected}
                  onSpeak={() => speakText(result.corrected)}
                  onCopy={() => copyText(result.corrected, setStatus, setStatusIsError)}
                />
                <ResultCard
                  title="更地道的英文"
                  text={result.polished}
                  onSpeak={() => speakText(result.polished)}
                  onCopy={() => copyText(result.polished, setStatus, setStatusIsError)}
                />
                <ResultCard
                  title="更口语化的表达"
                  text={result.colloquial}
                  onSpeak={() => speakText(result.colloquial)}
                  onCopy={() => copyText(result.colloquial, setStatus, setStatusIsError)}
                />
              </div>
            )}

            <div className="keyword-panel">
              <div className="panel-title">英语关键词</div>
              <div className="keywords">
                {keywords.length ? (
                  keywords.map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      className="keyword-chip"
                      onClick={() => speakText(keyword)}
                    >
                      {keyword}
                    </button>
                  ))
                ) : (
                  <span className="hint-text">翻译完成后会自动提取关键词，点击即可发音。</span>
                )}
              </div>
            </div>
          </section>
        </section>
      </main>
    </AppFrame>
  );
}

function RecordsPage() {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState("正在加载翻译记录...");
  const [statusIsError, setStatusIsError] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [location.pathname]);

  async function loadRecords() {
    setStatus("正在加载翻译记录...");
    setStatusIsError(false);

    try {
      const response = await fetch("/api/records");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error?.message || "加载翻译记录失败。");
      }

      const nextRecords = data?.records || [];
      setRecords(nextRecords);
      setStatus(`共加载 ${nextRecords.length} 条记录。`);
    } catch (error) {
      setRecords([]);
      setStatus(error.message || "加载翻译记录失败。");
      setStatusIsError(true);
    }
  }

  async function likeRecord(recordId) {
    try {
      const response = await fetch(`/api/records/${recordId}/like`, {
        method: "POST"
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error?.message || "点赞失败。");
      }

      setRecords((current) =>
        current.map((record) =>
          record.id === recordId
            ? { ...record, likes_count: data?.record?.likes_count ?? record.likes_count }
            : record
        )
      );
      setStatus("已点赞。");
      setStatusIsError(false);
    } catch (error) {
      setStatus(error.message || "点赞失败。");
      setStatusIsError(true);
    }
  }

  return (
    <AppFrame>
      <TopBar left={<Link className="topbar-action" to="/">← 返回首页</Link>} />

      <main className="page-shell page-shell--wide">
        <section className="content-card records-card">
          <header className="hero hero--compact">
            <h1>翻译记录</h1>
            <p>这里会显示大家保存下来的翻译结果，你可以继续点赞、发音和复制。</p>
          </header>

          <section className="toolbar">
            <button type="button" className="secondary-button" onClick={loadRecords}>刷新列表</button>
          </section>

          <div className={`status ${statusIsError ? "error" : ""}`}>{status}</div>

          <section className="records-grid">
            {records.length ? (
              records.map((record) => (
                <article key={record.id} className="record-card">
                  <div className="record-top">
                    <div className="record-meta-block">
                      <div className="record-meta">
                        <span className="pill">#{record.id}</span>
                        <span className="pill">{record.mode === "english" ? "英文润色" : "中文翻译"}</span>
                      </div>
                      <div className="record-meta subtle">{formatDate(record.created_at)}</div>
                    </div>

                    <div className="record-like">
                      <span className="pill">点赞 {record.likes_count || 0}</span>
                      <IconButton label="点赞" variant="accent" onClick={() => likeRecord(record.id)}>
                        <HeartIcon />
                      </IconButton>
                    </div>
                  </div>

                  <RecordBlock title="原文" text={record.source_text} />

                  {record.mode === "english" ? (
                    <>
                      {record.corrected ? <RecordBlock title="语法纠正" text={record.corrected} /> : null}
                      {record.polished ? <RecordBlock title="更地道的英文" text={record.polished} /> : null}
                      {record.colloquial ? <RecordBlock title="更口语化的表达" text={record.colloquial} /> : null}
                    </>
                  ) : (
                    record.translation ? <RecordBlock title="翻译结果" text={record.translation} /> : null
                  )}
                </article>
              ))
            ) : (
              <div className="empty-state">还没有翻译记录，先去首页翻译一句试试。</div>
            )}
          </section>
        </section>
      </main>
    </AppFrame>
  );
}

function AppFrame({ children }) {
  return <div className="app-frame">{children}</div>;
}

function TopBar({ left, right = null }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-side">{left}</div>
        <div className="topbar-side topbar-side--right">{right}</div>
      </div>
    </header>
  );
}

function ResultCard({ title, text, onSpeak, onCopy }) {
  return (
    <section className="result-card">
      <div className="result-title">{title}</div>
      <div className="result-body">{text || "暂无内容。"}</div>
      <div className="result-actions">
        <IconButton label="播放读音" onClick={onSpeak} disabled={!text.trim()}>
          <PlayIcon />
        </IconButton>
        <IconButton label="复制结果" onClick={onCopy} disabled={!text.trim()}>
          <CopyIcon />
        </IconButton>
      </div>
    </section>
  );
}

function RecordBlock({ title, text }) {
  return (
    <section className="record-block">
      <div className="result-title">{title}</div>
      <div className="result-body">{text}</div>
      <div className="result-actions">
        <IconButton label="播放读音" onClick={() => speakText(text)}>
          <PlayIcon />
        </IconButton>
        <IconButton label="复制结果" onClick={() => copyText(text)}>
          <CopyIcon />
        </IconButton>
      </div>
    </section>
  );
}

function IconButton({ children, label, onClick, disabled = false, variant = "soft" }) {
  return (
    <button
      type="button"
      className={`icon-button ${variant === "accent" ? "icon-button--accent" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6.5v11l8.5-5.5L8 6.5Z" fill="currentColor" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 9h9v10H9z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.3 4.7 13a4.8 4.8 0 0 1 6.8-6.8L12 6.7l.5-.5A4.8 4.8 0 0 1 19.3 13L12 20.3Z" fill="currentColor" />
    </svg>
  );
}

function createEmptyResult(message = "翻译结果会显示在这里。") {
  return {
    mode: "translation",
    translation: "",
    corrected: "",
    polished: "",
    colloquial: "",
    message
  };
}

function getBestEnglishResult(result) {
  return result.colloquial || result.polished || result.corrected || result.translation || "";
}

function extractKeywords(text) {
  return Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z][a-z'-]*/g) || [])
        .filter((word) => word.length > 2)
        .filter((word) => !STOP_WORDS.has(word))
    )
  ).slice(0, 10);
}

function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) || null;
}

function speakText(text) {
  const value = (text || "").trim();
  if (!("speechSynthesis" in window) || !value) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  const voice = getEnglishVoice();
  utterance.rate = 0.95;

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  window.speechSynthesis.speak(utterance);
}

async function copyText(text, setStatus = () => {}, setStatusIsError = () => {}) {
  const value = (text || "").trim();
  if (!value) {
    setStatus("没有可复制的内容。");
    setStatusIsError(true);
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setStatus("已复制到剪贴板。");
    setStatusIsError(false);
  } catch {
    setStatus("复制失败，请检查浏览器权限。");
    setStatusIsError(true);
  }
}

function formatDate(value) {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default App;
