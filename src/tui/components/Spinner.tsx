import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { theme, sym } from "../theme.js";

export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % sym.spinnerFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return <Text color={theme.accent}>{sym.spinnerFrames[frame]}</Text>;
}
