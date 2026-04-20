// Main types
export * from './types';
export * from './story-types';

// Database: generated Database type + Json scalar (from `supabase gen types`)
export type { Database, Json } from './database.types';

// Flat table-name aliases, derived from the generated Database type.
// See db-aliases.ts for the mapping — safe to regenerate database.types
// without losing caller-facing names.
export type {
  Character,
  CharacterInsert,
  ImageRow,
  ImageInsert,
  GenerationJobRow,
  GenerationJobInsert,
  StorySeriesInsert,
  StoryPostInsert,
  StoryCharacterInsert,
  StoryImagePromptInsert,
  NswUser,
  NswUserInsert,
  NswUserUpdate,
  NswSubscription,
  NswSubscriptionInsert,
  NswPayment,
  NswPaymentInsert,
  NswPurchase,
  NswPurchaseInsert,
} from './db-aliases';

// Constants
export * from './constants';

// Utilities
export * from './utils';
