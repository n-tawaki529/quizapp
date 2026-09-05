import { useState } from "react";
import { adminApi, mediaUrl } from "../api";
import { ChoiceContentType, ChoiceKey, MediaType, QuestionAdminOut } from "../types";

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D"];

interface ChoiceFormState {
  content_type: ChoiceContentType;
  text: string;
  media_url: string;
}

interface Props {
  eventId: string;
  initial?: QuestionAdminOut | null;
  nextQuestionNumber: number;
  hasPracticeQuestion: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

function buildInitialChoices(initial?: QuestionAdminOut | null): Record<ChoiceKey, ChoiceFormState> {
  const base: Record<ChoiceKey, ChoiceFormState> = {
    A: { content_type: "TEXT", text: "", media_url: "" },
    B: { content_type: "TEXT", text: "", media_url: "" },
    C: { content_type: "TEXT", text: "", media_url: "" },
    D: { content_type: "TEXT", text: "", media_url: "" },
  };
  if (initial) {
    for (const c of initial.choices) {
      base[c.choice_key] = {
        content_type: c.content_type,
        text: c.text || "",
        media_url: c.media_url || "",
      };
    }
  }
  return base;
}

export default function QuestionForm({
  eventId,
  initial,
  nextQuestionNumber,
  hasPracticeQuestion,
  onSaved,
  onCancel,
}: Props) {
  const [questionNumber, setQuestionNumber] = useState(initial?.question_number ?? nextQuestionNumber);
  const [isPractice, setIsPractice] = useState(initial?.is_practice ?? false);
  const [questionText, setQuestionText] = useState(initial?.question_text ?? "");
  const [questionMediaType, setQuestionMediaType] = useState<MediaType>(initial?.question_media_type ?? "NONE");
  const [questionMediaUrl, setQuestionMediaUrl] = useState(initial?.question_media_url ?? "");
  const [timeLimit, setTimeLimit] = useState(initial?.time_limit_seconds ?? 10);
  const [correctChoice, setCorrectChoice] = useState<ChoiceKey>(initial?.correct_choice ?? "A");
  const [choices, setChoices] = useState<Record<ChoiceKey, ChoiceFormState>>(buildInitialChoices(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  function updateChoice(key: ChoiceKey, patch: Partial<ChoiceFormState>) {
    setChoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleQuestionMediaUpload(file: File) {
    setUploadingKey("question");
    try {
      const res = await adminApi.uploadMedia(file);
      setQuestionMediaUrl(res.url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingKey(null);
    }
  }

  async function handleChoiceMediaUpload(key: ChoiceKey, file: File) {
    setUploadingKey(key);
    try {
      const res = await adminApi.uploadMedia(file);
      updateChoice(key, { media_url: res.url });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingKey(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        question_number: isPractice ? 0 : questionNumber,
        question_text: questionText,
        question_media_type: questionMediaType,
        question_media_url: questionMediaType === "NONE" ? null : questionMediaUrl || null,
        time_limit_seconds: timeLimit,
        correct_choice: correctChoice,
        is_practice: isPractice,
        choices: CHOICE_KEYS.map((key) => ({
          choice_key: key,
          content_type: choices[key].content_type,
          text: choices[key].content_type === "TEXT" ? choices[key].text : null,
          media_url: choices[key].content_type === "TEXT" ? null : choices[key].media_url || null,
        })),
      };
      if (initial) {
        await adminApi.put(`/api/admin/events/${eventId}/questions/${initial.id}`, body);
      } else {
        await adminApi.post(`/api/admin/events/${eventId}/questions`, body);
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h3>{initial ? "問題を編集" : "問題を追加"}</h3>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isPractice}
            disabled={hasPracticeQuestion && !initial?.is_practice}
            onChange={(e) => setIsPractice(e.target.checked)}
          />{" "}
          これは練習問題です(得点・ランキングには反映されません。1大会に1問まで)
        </label>
        {hasPracticeQuestion && !initial?.is_practice && (
          <p style={{ fontSize: 12, color: "#6b7280" }}>
            既に練習問題が設定されているため、新たに練習問題として登録することはできません。
          </p>
        )}
      </div>

      <div className="row">
        <div className="field" style={{ width: 120 }}>
          <label>問題番号</label>
          <input
            type="number"
            min={1}
            value={isPractice ? "" : questionNumber}
            disabled={isPractice}
            placeholder={isPractice ? "練習問題(常に先頭)" : undefined}
            onChange={(e) => setQuestionNumber(Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>制限時間(秒)</label>
          <input type="number" min={1} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} />
        </div>
      </div>

      <div className="field">
        <label>問題文</label>
        <textarea rows={2} value={questionText} onChange={(e) => setQuestionText(e.target.value)} required />
      </div>

      <div className="field">
        <label>問題に添付するメディア(任意・会場モニターのみに表示)</label>
        <select value={questionMediaType} onChange={(e) => setQuestionMediaType(e.target.value as MediaType)}>
          <option value="NONE">なし</option>
          <option value="IMAGE">画像</option>
          <option value="VIDEO">動画</option>
        </select>
        {questionMediaType !== "NONE" && (
          <div className="row" style={{ marginTop: 6 }}>
            <input
              type="file"
              accept={questionMediaType === "IMAGE" ? "image/*" : "video/*"}
              onChange={(e) => e.target.files && handleQuestionMediaUpload(e.target.files[0])}
            />
            {uploadingKey === "question" && <span>アップロード中...</span>}
            {questionMediaUrl && (
              <a href={mediaUrl(questionMediaUrl)} target="_blank" rel="noreferrer">
                プレビュー
              </a>
            )}
          </div>
        )}
      </div>

      <h4>選択肢(会場モニターにのみ内容を表示。参加者にはA〜Dのボタンのみ表示)</h4>
      {CHOICE_KEYS.map((key) => (
        <div className="card" key={key} style={{ background: "#f9fafb" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>選択肢 {key}</strong>
            <label className="row" style={{ gap: 4 }}>
              <input
                type="radio"
                name="correct_choice"
                checked={correctChoice === key}
                onChange={() => setCorrectChoice(key)}
              />
              これが正解
            </label>
          </div>
          <div className="field">
            <label>表示形式</label>
            <select
              value={choices[key].content_type}
              onChange={(e) => updateChoice(key, { content_type: e.target.value as ChoiceContentType })}
            >
              <option value="TEXT">テキスト</option>
              <option value="IMAGE">画像</option>
              <option value="VIDEO">動画</option>
            </select>
          </div>
          {choices[key].content_type === "TEXT" ? (
            <div className="field">
              <label>テキスト</label>
              <input value={choices[key].text} onChange={(e) => updateChoice(key, { text: e.target.value })} />
            </div>
          ) : (
            <div className="row">
              <input
                type="file"
                accept={choices[key].content_type === "IMAGE" ? "image/*" : "video/*"}
                onChange={(e) => e.target.files && handleChoiceMediaUpload(key, e.target.files[0])}
              />
              {uploadingKey === key && <span>アップロード中...</span>}
              {choices[key].media_url && (
                <a href={mediaUrl(choices[key].media_url)} target="_blank" rel="noreferrer">
                  プレビュー
                </a>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" type="submit" disabled={saving}>
          保存
        </button>
        <button className="btn secondary" type="button" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
