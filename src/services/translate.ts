import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
});

export async function translate(
  text: string,
  fromLang: string,
  toLang: string,
): Promise<{ translation: string }> {
  const { text: result } = await generateText({
    model: openai('gpt-4o-mini'),
    system: `You are a translator. Translate from ${fromLang} to ${toLang}. Return ONLY the translation, nothing else.`,
    prompt: text,
  });
  return { translation: result.trim() };
}
