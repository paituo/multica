import { useEffect } from "react";
import { currentThemeName, monaco } from "./monaco-setup";

/**
 * Point Monaco at the app's theme, and keep it pointed there.
 *
 * `next-themes` toggles dark mode by flipping `html.dark`, which Monaco cannot
 * observe; without this the editors stay in whichever theme they were created
 * with while the rest of the window switches. Shared by the file viewer and the
 * diff view so the two cannot drift.
 */
export function useMonacoTheme(): void {
  useEffect(() => {
    const apply = () => monaco.editor.setTheme(currentThemeName());
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
}
