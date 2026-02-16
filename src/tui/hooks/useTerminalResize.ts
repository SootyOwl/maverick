import { useEffect, useState } from "react";
import { useStdout } from "ink";

/**
 * Hook that detects terminal resize and clears the screen to prevent
 * rendering artifacts. Ink only clears on width *decrease*; this hook
 * clears on ANY dimension change, then forces a re-render.
 *
 * Returns current { columns, rows } so components can adapt to size.
 */
export function useTerminalResize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });

  useEffect(() => {
    let lastCols = stdout.columns ?? 80;
    let lastRows = stdout.rows ?? 24;

    const handler = () => {
      const newCols = stdout.columns ?? 80;
      const newRows = stdout.rows ?? 24;

      // Only act if dimensions actually changed
      if (newCols === lastCols && newRows === lastRows) return;

      // Clear screen on ANY resize to prevent leftover artifacts.
      // Ink's built-in handling of width decrease is insufficient.
      stdout.write("\x1b[2J\x1b[3J\x1b[H");

      lastCols = newCols;
      lastRows = newRows;

      // Update state to trigger re-render with new dimensions
      setSize({ columns: newCols, rows: newRows });
    };

    stdout.on("resize", handler);
    return () => {
      stdout.off("resize", handler);
    };
  }, [stdout]);

  return size;
}
