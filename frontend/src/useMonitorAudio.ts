import { useCallback, useEffect, useRef, useState } from "react";
import { BGM_TIME_LIMIT_SECONDS, ANSWER_BGM_VOLUME, CORRECT_SE_VOLUME, MONITOR_AUDIO_ASSETS } from "./monitorAudioConfig";
import { MonitorState } from "./types";

type AudioPair = {
  answerBgm: HTMLAudioElement;
  correctSe: HTMLAudioElement;
};

function stopAudio(audio: HTMLAudioElement) {
  audio.pause();
  audio.currentTime = 0;
}

export function useMonitorAudio(state: MonitorState | null, eventId: string | undefined) {
  const audioRef = useRef<AudioPair | null>(null);
  const previousPhaseRef = useRef<MonitorState["phase"] | null>(null);
  const previousQuestionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const answerOpenPendingRef = useRef(false);
  const answerBgmStartedRef = useRef(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  useEffect(() => {
    const answerBgm = new Audio(MONITOR_AUDIO_ASSETS.answerBgm);
    const correctSe = new Audio(MONITOR_AUDIO_ASSETS.correctSe);
    answerBgm.preload = "auto";
    correctSe.preload = "auto";
    answerBgm.volume = ANSWER_BGM_VOLUME;
    correctSe.volume = CORRECT_SE_VOLUME;
    answerBgm.load();
    correctSe.load();
    audioRef.current = { answerBgm, correctSe };

    return () => {
      stopAudio(answerBgm);
      stopAudio(correctSe);
      answerBgm.removeAttribute("src");
      correctSe.removeAttribute("src");
      answerBgm.load();
      correctSe.load();
      audioRef.current = null;
    };
  }, []);

  const enableAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const unlock = (element: HTMLAudioElement) => {
      const playback = element.play();
      void playback.then(() => {
        element.pause();
        element.currentTime = 0;
      }).catch(() => undefined);
      return playback;
    };

    void Promise.allSettled([unlock(audio.answerBgm), unlock(audio.correctSe)]).then(() => {
      setAudioEnabled(true);
    });
  }, []);

  useEffect(() => {
    initializedRef.current = false;
    previousPhaseRef.current = null;
    previousQuestionIdRef.current = null;
    answerOpenPendingRef.current = false;
    answerBgmStartedRef.current = false;
    if (audioRef.current) {
      stopAudio(audioRef.current.answerBgm);
      stopAudio(audioRef.current.correctSe);
    }
  }, [eventId]);

  useEffect(() => {
    if (!state || !eventId || state.event_id !== eventId) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      previousPhaseRef.current = state.phase;
      previousQuestionIdRef.current = state.question?.id ?? null;
      return;
    }

    const previousPhase = previousPhaseRef.current;
    const questionChangedDuringAnswerOpen =
      previousPhase === "ANSWER_OPEN" &&
      state.phase === "ANSWER_OPEN" &&
      previousQuestionIdRef.current !== state.question?.id;
    const enteredAnswerOpen =
      (previousPhase !== "ANSWER_OPEN" && state.phase === "ANSWER_OPEN") || questionChangedDuringAnswerOpen;
    const enteredCorrectAnswer =
      previousPhase !== "CORRECT_ANSWER_SHOWN" && state.phase === "CORRECT_ANSWER_SHOWN";
    const isTenSecondQuestion = state.question?.time_limit_seconds === BGM_TIME_LIMIT_SECONDS;

    if (enteredAnswerOpen) {
      answerOpenPendingRef.current = isTenSecondQuestion;
      answerBgmStartedRef.current = false;
    }

    if (state.phase !== "ANSWER_OPEN") {
      answerOpenPendingRef.current = false;
      answerBgmStartedRef.current = false;
    }

    const audio = audioRef.current;
    if (audioEnabled && audio && answerOpenPendingRef.current && !answerBgmStartedRef.current) {
      stopAudio(audio.answerBgm);
      answerBgmStartedRef.current = true;
      void audio.answerBgm.play().catch(() => {
        answerBgmStartedRef.current = false;
      });
    }

    if (audioEnabled && audio && enteredCorrectAnswer) {
      audio.correctSe.currentTime = 0;
      void audio.correctSe.play().catch(() => undefined);
    }

    if (state.phase === "NOT_STARTED" && audio) {
      stopAudio(audio.answerBgm);
      stopAudio(audio.correctSe);
    }

    previousPhaseRef.current = state.phase;
    previousQuestionIdRef.current = state.question?.id ?? null;
  }, [audioEnabled, eventId, state?.event_id, state?.phase, state?.question?.id, state?.question?.time_limit_seconds]);

  return { audioEnabled, enableAudio };
}