export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      nsw_users: {
        Row: {
          id: string;
          auth_user_id: string;
          email: string;
          display_name: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          email: string;
          display_name?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          email?: string;
          display_name?: string | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nsw_users_auth_user_id_fkey";
            columns: ["auth_user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      nsw_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan: string;
          status: string;
          starts_at: string;
          ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan: string;
          status: string;
          starts_at: string;
          ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan?: string;
          status?: string;
          starts_at?: string;
          ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nsw_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "nsw_users";
            referencedColumns: ["id"];
          },
        ];
      };
      nsw_payments: {
        Row: {
          id: string;
          user_id: string;
          subscription_id: string | null;
          amount: number;
          currency: string;
          status: string;
          payment_provider: string | null;
          provider_payment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subscription_id?: string | null;
          amount: number;
          currency?: string;
          status: string;
          payment_provider?: string | null;
          provider_payment_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          subscription_id?: string | null;
          amount?: number;
          currency?: string;
          status?: string;
          payment_provider?: string | null;
          provider_payment_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "nsw_payments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "nsw_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nsw_payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "nsw_subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      nsw_purchases: {
        Row: {
          id: string;
          user_id: string;
          series_id: string;
          amount: number;
          currency: string;
          payment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          series_id: string;
          amount: number;
          currency?: string;
          payment_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          series_id?: string;
          amount?: number;
          currency?: string;
          payment_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "nsw_purchases_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "nsw_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nsw_purchases_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "story_series";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nsw_purchases_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "nsw_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      content_types: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      characters: {
        Row: {
          id: string;
          name: string;
          description: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      images: {
        Row: {
          id: string;
          character_id: string | null;
          sfw_url: string | null;
          nsfw_url: string | null;
          stored_url: string | null;
          prompt: string;
          negative_prompt: string;
          settings: Json;
          mode: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          character_id?: string | null;
          sfw_url?: string | null;
          nsfw_url?: string | null;
          stored_url?: string | null;
          prompt: string;
          negative_prompt?: string;
          settings?: Json;
          mode?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          character_id?: string | null;
          sfw_url?: string | null;
          nsfw_url?: string | null;
          stored_url?: string | null;
          prompt?: string;
          negative_prompt?: string;
          settings?: Json;
          mode?: string;
        };
        Relationships: [
          {
            foreignKeyName: "images_character_id_fkey";
            columns: ["character_id"];
            isOneToOne: false;
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
        ];
      };
      generation_jobs: {
        Row: {
          id: string;
          job_id: string;
          image_id: string | null;
          status: string;
          cost: number | null;
          error: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          job_id: string;
          image_id?: string | null;
          status?: string;
          cost?: number | null;
          error?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string;
          image_id?: string | null;
          status?: string;
          cost?: number | null;
          error?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "generation_jobs_image_id_fkey";
            columns: ["image_id"];
            isOneToOne: false;
            referencedRelation: "images";
            referencedColumns: ["id"];
          },
        ];
      };
      story_series: {
        Row: {
          id: string;
          title: string;
          slug: string;
          description: string | null;
          total_parts: number;
          hashtag: string | null;
          status: string;
          marketing: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          slug: string;
          description?: string | null;
          total_parts: number;
          hashtag?: string | null;
          status?: string;
          marketing?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          slug?: string;
          description?: string | null;
          total_parts?: number;
          hashtag?: string | null;
          status?: string;
          marketing?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      story_posts: {
        Row: {
          id: string;
          series_id: string;
          part_number: number;
          title: string;
          facebook_content: string;
          facebook_teaser: string | null;
          facebook_comment: string | null;
          website_content: string;
          hashtags: string[];
          status: string;
          facebook_post_id: string | null;
          published_at: string | null;
          scheduled_for: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          series_id: string;
          part_number: number;
          title: string;
          facebook_content: string;
          facebook_teaser?: string | null;
          facebook_comment?: string | null;
          website_content: string;
          hashtags?: string[];
          status?: string;
          facebook_post_id?: string | null;
          published_at?: string | null;
          scheduled_for?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          series_id?: string;
          part_number?: number;
          title?: string;
          facebook_content?: string;
          facebook_teaser?: string | null;
          facebook_comment?: string | null;
          website_content?: string;
          hashtags?: string[];
          status?: string;
          facebook_post_id?: string | null;
          published_at?: string | null;
          scheduled_for?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_posts_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "story_series";
            referencedColumns: ["id"];
          },
        ];
      };
      story_characters: {
        Row: {
          id: string;
          series_id: string;
          character_id: string;
          role: string;
          prose_description: string | null;
          approved: boolean;
          approved_image_id: string | null;
          approved_seed: number | null;
          approved_prompt: string | null;
        };
        Insert: {
          id?: string;
          series_id: string;
          character_id: string;
          role: string;
          prose_description?: string | null;
          approved?: boolean;
          approved_image_id?: string | null;
          approved_seed?: number | null;
          approved_prompt?: string | null;
        };
        Update: {
          id?: string;
          series_id?: string;
          character_id?: string;
          role?: string;
          prose_description?: string | null;
          approved?: boolean;
          approved_image_id?: string | null;
          approved_seed?: number | null;
          approved_prompt?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "story_characters_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "story_series";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_characters_character_id_fkey";
            columns: ["character_id"];
            isOneToOne: false;
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_characters_approved_image_id_fkey";
            columns: ["approved_image_id"];
            isOneToOne: false;
            referencedRelation: "images";
            referencedColumns: ["id"];
          },
        ];
      };
      story_image_prompts: {
        Row: {
          id: string;
          post_id: string;
          image_type: string;
          pairs_with: string | null;
          position: number;
          position_after_word: number | null;
          character_name: string | null;
          character_id: string | null;
          secondary_character_name: string | null;
          secondary_character_id: string | null;
          prompt: string;
          image_id: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          image_type: string;
          pairs_with?: string | null;
          position: number;
          position_after_word?: number | null;
          character_name?: string | null;
          character_id?: string | null;
          secondary_character_name?: string | null;
          secondary_character_id?: string | null;
          prompt: string;
          image_id?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          image_type?: string;
          pairs_with?: string | null;
          position?: number;
          position_after_word?: number | null;
          character_name?: string | null;
          character_id?: string | null;
          secondary_character_name?: string | null;
          secondary_character_id?: string | null;
          prompt?: string;
          image_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_image_prompts_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "story_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_image_prompts_pairs_with_fkey";
            columns: ["pairs_with"];
            isOneToOne: false;
            referencedRelation: "story_image_prompts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_image_prompts_character_id_fkey";
            columns: ["character_id"];
            isOneToOne: false;
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_image_prompts_secondary_character_id_fkey";
            columns: ["secondary_character_id"];
            isOneToOne: false;
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_image_prompts_image_id_fkey";
            columns: ["image_id"];
            isOneToOne: false;
            referencedRelation: "images";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export interface CharacterDescription {
  gender: string;
  ethnicity: string;
  bodyType: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  distinguishingFeatures: string;
  clothing: string;
  pose: string;
  expression: string;
  age: string;
}

export interface ImageSettings {
  modelUrn: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  scheduler: string;
  seed: number;
  clipSkip: number;
  batchSize: number;
}

// NSW User-related types
export type NswUser = Database["public"]["Tables"]["nsw_users"]["Row"];
export type NswUserInsert = Database["public"]["Tables"]["nsw_users"]["Insert"];
export type NswUserUpdate = Database["public"]["Tables"]["nsw_users"]["Update"];
export type NswSubscription = Database["public"]["Tables"]["nsw_subscriptions"]["Row"];
export type NswSubscriptionInsert = Database["public"]["Tables"]["nsw_subscriptions"]["Insert"];
export type NswSubscriptionUpdate = Database["public"]["Tables"]["nsw_subscriptions"]["Update"];
export type NswPayment = Database["public"]["Tables"]["nsw_payments"]["Row"];
export type NswPaymentInsert = Database["public"]["Tables"]["nsw_payments"]["Insert"];
export type NswPaymentUpdate = Database["public"]["Tables"]["nsw_payments"]["Update"];
export type NswPurchase = Database["public"]["Tables"]["nsw_purchases"]["Row"];
export type NswPurchaseInsert = Database["public"]["Tables"]["nsw_purchases"]["Insert"];
export type NswPurchaseUpdate = Database["public"]["Tables"]["nsw_purchases"]["Update"];

// Content types
export type ContentType = Database["public"]["Tables"]["content_types"]["Row"];
export type ContentTypeInsert = Database["public"]["Tables"]["content_types"]["Insert"];
export type ContentTypeUpdate = Database["public"]["Tables"]["content_types"]["Update"];

// Character and image types
export type Character = Database["public"]["Tables"]["characters"]["Row"];
export type CharacterInsert =
  Database["public"]["Tables"]["characters"]["Insert"];
export type ImageRow = Database["public"]["Tables"]["images"]["Row"];
export type ImageInsert = Database["public"]["Tables"]["images"]["Insert"];
export type GenerationJobRow =
  Database["public"]["Tables"]["generation_jobs"]["Row"];
export type GenerationJobInsert =
  Database["public"]["Tables"]["generation_jobs"]["Insert"];

// Story types
export type StorySeriesRow =
  Database["public"]["Tables"]["story_series"]["Row"];
export type StorySeriesInsert =
  Database["public"]["Tables"]["story_series"]["Insert"];
export type StoryPostRow =
  Database["public"]["Tables"]["story_posts"]["Row"];
export type StoryPostInsert =
  Database["public"]["Tables"]["story_posts"]["Insert"];
export type StoryCharacterRow =
  Database["public"]["Tables"]["story_characters"]["Row"];
export type StoryCharacterInsert =
  Database["public"]["Tables"]["story_characters"]["Insert"];
export type StoryImagePromptRow =
  Database["public"]["Tables"]["story_image_prompts"]["Row"];
export type StoryImagePromptInsert =
  Database["public"]["Tables"]["story_image_prompts"]["Insert"];
