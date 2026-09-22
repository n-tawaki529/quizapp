import { useEffect, useRef } from "react";
import { mediaUrl } from "./api";
import { MediaType, MonitorState } from "./types";

type MediaEntry = { media_type: MediaType; media_url: string };

function preloadImage(url: string): HTMLImageElement {
  const image = new Image();
  image.src = url;
  const decoded = image.decode?.();
  if (decoded) void decoded.catch(() => undefined);
  return image;
}

export function useMediaPreloader(state: MonitorState | null) {
  const imageRefs = useRef(new Map<string, HTMLImageElement>());
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nextMediaPreviewSignature = JSON.stringify(state?.next_media_preview ?? null);

  useEffect(() => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
    containerRef.current = container;

    return () => {
      for (const video of videoRefs.current.values()) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      videoRefs.current.clear();
      imageRefs.current.clear();
      container.remove();
      containerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const targets = new Map<string, MediaType>();
    const addTarget = (entry: MediaEntry | null | undefined) => {
      if (!entry?.media_url || (entry.media_type !== "IMAGE" && entry.media_type !== "VIDEO")) return;
      const url = mediaUrl(entry.media_url);
      if (url) targets.set(url, entry.media_type);
    };

    addTarget(state?.question?.pre_correct_media_url && state.question.pre_correct_media_type
      ? { media_type: state.question.pre_correct_media_type, media_url: state.question.pre_correct_media_url }
      : null);
    addTarget(state?.next_media_preview?.question_media);
    addTarget(state?.next_media_preview?.pre_question_media);
    for (const choice of state?.next_media_preview?.choice_media ?? []) addTarget(choice);

    for (const [url, image] of imageRefs.current) {
      if (!targets.has(url) || targets.get(url) !== "IMAGE") {
        image.src = "";
        imageRefs.current.delete(url);
      }
    }
    for (const [url, video] of videoRefs.current) {
      if (!targets.has(url) || targets.get(url) !== "VIDEO") {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
        videoRefs.current.delete(url);
      }
    }

    const container = containerRef.current;
    if (!container) return;
    for (const [url, mediaType] of targets) {
      if (mediaType === "IMAGE" && !imageRefs.current.has(url)) {
        imageRefs.current.set(url, preloadImage(url));
      }
      if (mediaType === "VIDEO" && !videoRefs.current.has(url)) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.src = url;
        container.appendChild(video);
        video.load();
        videoRefs.current.set(url, video);
      }
    }
  }, [nextMediaPreviewSignature, state?.question?.pre_correct_media_type, state?.question?.pre_correct_media_url]);
}