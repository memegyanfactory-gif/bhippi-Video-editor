// A results section a model wrote into its own answer — Helios' "What your last reply's calls
// actually returned" block copied, or invented, by a CLI on the text protocol. The backend now
// hides it as it streams (ai_tools.rs FenceFilter); answers saved before that still carry it, so
// it is folded into one small "tool-results" code window instead of a wall of JSON in the words.

const MARKERS = [/^#{1,6}\s*What your last reply's calls actually returned/, /^Use the ids and values below instead of ones you guessed/];
/** `- \`edit_file\` → {…}`: one call's result, as Helios lists them. */
const RESULT = /^\s*[-*•]\s+`[\w.-]+`\s*(→|->)/;
/** The instructions Helios closes the section with. */
const CLOSING = /^(If a job is still running|Now continue)/;

export function foldToolEcho(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!MARKERS.some((marker) => marker.test(lines[index].trim()))) {
      out.push(lines[index++]);
      continue;
    }
    const section: string[] = [];
    // The heading, its lead line, every result (with any lines it wrapped onto) and the closing
    // instructions; the first other paragraph is the model talking again.
    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      const continues = (section[section.length - 1]?.trim() ?? '') !== '' && !trimmed.startsWith('#');
      const part = trimmed === '' || continues || RESULT.test(line) || CLOSING.test(trimmed) || MARKERS.some((marker) => marker.test(trimmed));
      if (!part) break;
      section.push(line);
      index++;
    }
    while (section.length && section[section.length - 1].trim() === '') {
      section.pop();
      index--;
    }
    out.push('```tool-results', ...section.map((line) => line.replace(/```/g, "'''")), '```');
  }
  return out.join('\n');
}
