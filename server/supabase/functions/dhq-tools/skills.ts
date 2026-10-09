// DHQ skills — the methodology, published beside the tools.
//
// Each skill is DHQ's method for one kind of question, written for the
// member's AI to read before it answers: which tool to call, what the
// numbers mean, what decides the call, and what the answer must say.
// They are served as MCP prompts (prompts/list, prompts/get) and also as
// the `method` text inside the matching verdict tool's result, so an AI
// that never reads prompts still sees the method where it matters.
export interface Skill { name: string; title: string; description: string; text: string }

export const SKILLS: Skill[] = [];

export function skillText(name: string): string | undefined {
  const s = SKILLS.find(x => x.name === name);
  return s ? s.text : undefined;
}
