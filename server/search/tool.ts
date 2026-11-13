import { z } from 'zod';
import { searchInputSchema } from '../../shared/domain.js';

export const webSearchArgumentsSchema = z.object({
  queries: z.array(searchInputSchema.strict()).min(1).max(4),
}).strict();

export type WebSearchArguments = z.infer<typeof webSearchArgumentsSchema>;

export const webSearchTool = {
  type: 'function' as const,
  name: 'web_search',
  description: 'Search public web sources using concise public research terms.',
  parameters: z.toJSONSchema(webSearchArgumentsSchema),
};

export function parseWebSearchArguments(value: unknown): WebSearchArguments {
  return webSearchArgumentsSchema.parse(value);
}
