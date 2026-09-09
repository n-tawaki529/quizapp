import { useEffect, useState } from "react";

function getCanvasScale(designWidth: number, designHeight: number): number {
  return Math.min(window.innerWidth / designWidth, window.innerHeight / designHeight);
}

export function useCanvasScale(designWidth = 1920, designHeight = 1080): number {
  const [scale, setScale] = useState(() => getCanvasScale(designWidth, designHeight));

  useEffect(() => {
    const handleResize = () => setScale(getCanvasScale(designWidth, designHeight));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [designWidth, designHeight]);

  return scale;
}