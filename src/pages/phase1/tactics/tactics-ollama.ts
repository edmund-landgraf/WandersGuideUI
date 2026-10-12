const MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'llama3';

export async function ollamaComment(facts: string[], encounterBlock: string): Promise<{ text: string; modelDown: boolean }> {
  if (facts.length === 0) {
    return { text: 'No sheet veto applies to this turn.', modelDown: false };
  }
  try {
    const response = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You comment on a finished Pathfinder 2e enemy turn. Use only the facts given. Do not choose actions. Write two or three sentences. Do not invent numbers.',
          },
          { role: 'user', content: `Facts:\n${facts.map((fact) => `- ${fact}`).join('\n')}\n\nEncounter:\n${encounterBlock}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    if (!text) throw new Error('empty');
    return { text, modelDown: false };
  } catch {
    return {
      text: `${facts.join(' ')} The model went away.`,
      modelDown: true,
    };
  }
}

export async function ollamaDesign(sentence: string, encounterBlock: string): Promise<{ line: string; comment: string; modelDown: boolean }> {
  try {
    const response = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'A GM described an enemy turn. Say if the actions do not add up, or name the catch (multiple attack penalty, Reactive Strike on a retreat, ending fascination). Then propose one rules line. Do not invent numbers that are missing from the encounter block. Reply as JSON {"comment":"...","line":"..."}.',
          },
          { role: 'user', content: `Turn: ${sentence}\n\nEncounter:\n${encounterBlock}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { message?: { content?: string } };
    const raw = data.message?.content?.trim() ?? '';
    const json = raw.match(/\{[\s\S]*\}/);
    if (!json) throw new Error('no json');
    const parsed = JSON.parse(json[0]) as { comment?: string; line?: string };
    if (!parsed.line) throw new Error('no line');
    return { line: parsed.line, comment: parsed.comment || 'Rules check finished.', modelDown: false };
  } catch {
    return {
      line: sentence,
      comment: 'The rules check did not run.',
      modelDown: true,
    };
  }
}
