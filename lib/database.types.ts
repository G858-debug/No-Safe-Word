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

export type Character = Database["public"]["Tables"]["characters"]["Row"];
export type CharacterInsert =
  Database["public"]["Tables"]["characters"]["Insert"];
export type ImageRow = Database["public"]["Tables"]["images"]["Row"];
export type ImageInsert = Database["public"]["Tables"]["images"]["Insert"];
export type GenerationJobRow =
  Database["public"]["Tables"]["generation_jobs"]["Row"];
export type GenerationJobInsert =
  Database["public"]["Tables"]["generation_jobs"]["Insert"];
