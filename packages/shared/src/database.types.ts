export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string | null
          device_info: Json | null
          event_type: string
          id: string
          metadata: Json | null
          timestamp: string
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string | null
          device_info?: Json | null
          event_type: string
          id?: string
          metadata?: Json | null
          timestamp: string
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string | null
          device_info?: Json | null
          event_type?: string
          id?: string
          metadata?: Json | null
          timestamp?: string
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      art_director_jobs: {
        Row: {
          adapted_recipe: Json | null
          best_iteration: number | null
          best_score: number | null
          created_at: string
          current_iteration: number
          error: string | null
          final_image_id: string | null
          final_image_url: string | null
          id: string
          intent_analysis: Json | null
          iterations: Json
          prompt_id: string
          reference_images: Json | null
          selected_reference_id: number | null
          series_id: string
          status: string
          updated_at: string
        }
        Insert: {
          adapted_recipe?: Json | null
          best_iteration?: number | null
          best_score?: number | null
          created_at?: string
          current_iteration?: number
          error?: string | null
          final_image_id?: string | null
          final_image_url?: string | null
          id?: string
          intent_analysis?: Json | null
          iterations?: Json
          prompt_id: string
          reference_images?: Json | null
          selected_reference_id?: number | null
          series_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          adapted_recipe?: Json | null
          best_iteration?: number | null
          best_score?: number | null
          created_at?: string
          current_iteration?: number
          error?: string | null
          final_image_id?: string | null
          final_image_url?: string | null
          id?: string
          intent_analysis?: Json | null
          iterations?: Json
          prompt_id?: string
          reference_images?: Json | null
          selected_reference_id?: number | null
          series_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "art_director_jobs_final_image_id_fkey"
            columns: ["final_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          approved_fullbody_image_id: string | null
          approved_fullbody_prompt: string | null
          approved_fullbody_seed: number | null
          approved_image_id: string | null
          approved_prompt: string | null
          approved_seed: number | null
          created_at: string
          description: Json
          id: string
          name: string
          portrait_prompt_locked: string | null
          updated_at: string
        }
        Insert: {
          approved_fullbody_image_id?: string | null
          approved_fullbody_prompt?: string | null
          approved_fullbody_seed?: number | null
          approved_image_id?: string | null
          approved_prompt?: string | null
          approved_seed?: number | null
          created_at?: string
          description?: Json
          id?: string
          name: string
          portrait_prompt_locked?: string | null
          updated_at?: string
        }
        Update: {
          approved_fullbody_image_id?: string | null
          approved_fullbody_prompt?: string | null
          approved_fullbody_seed?: number | null
          approved_image_id?: string | null
          approved_prompt?: string | null
          approved_seed?: number | null
          created_at?: string
          description?: Json
          id?: string
          name?: string
          portrait_prompt_locked?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "characters_approved_fullbody_image_id_fkey"
            columns: ["approved_fullbody_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_approved_image_id_fkey"
            columns: ["approved_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          purpose: string
          role: string
          token_hash: string
          used: boolean | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          purpose?: string
          role: string
          token_hash: string
          used?: boolean | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          purpose?: string
          role?: string
          token_hash?: string
          used?: boolean | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      generation_evaluations: {
        Row: {
          attempt_number: number
          booru_tags: string
          character_distinction_score: number | null
          clothing_score: number | null
          composition_score: number | null
          composition_type: string
          content_mode: string
          corrections_applied: Json | null
          created_at: string
          eval_model: string
          failure_categories: string[]
          generation_params: Json
          id: string
          image_id: string
          intent_score: number | null
          lighting_score: number | null
          original_prose: string
          overall_score: number | null
          passed: boolean
          person_count_detected: number | null
          person_count_expected: number
          pose_score: number | null
          prompt_id: string
          raw_eval_response: Json | null
          setting_score: number | null
        }
        Insert: {
          attempt_number: number
          booru_tags: string
          character_distinction_score?: number | null
          clothing_score?: number | null
          composition_score?: number | null
          composition_type: string
          content_mode: string
          corrections_applied?: Json | null
          created_at?: string
          eval_model?: string
          failure_categories?: string[]
          generation_params?: Json
          id?: string
          image_id: string
          intent_score?: number | null
          lighting_score?: number | null
          original_prose: string
          overall_score?: number | null
          passed?: boolean
          person_count_detected?: number | null
          person_count_expected: number
          pose_score?: number | null
          prompt_id: string
          raw_eval_response?: Json | null
          setting_score?: number | null
        }
        Update: {
          attempt_number?: number
          booru_tags?: string
          character_distinction_score?: number | null
          clothing_score?: number | null
          composition_score?: number | null
          composition_type?: string
          content_mode?: string
          corrections_applied?: Json | null
          created_at?: string
          eval_model?: string
          failure_categories?: string[]
          generation_params?: Json
          id?: string
          image_id?: string
          intent_score?: number | null
          lighting_score?: number | null
          original_prose?: string
          overall_score?: number | null
          passed?: boolean
          person_count_detected?: number | null
          person_count_expected?: number
          pose_score?: number | null
          prompt_id?: string
          raw_eval_response?: Json | null
          setting_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_evaluations_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          completed_at: string | null
          cost: number | null
          created_at: string
          error: string | null
          id: string
          image_id: string | null
          job_id: string
          job_type: string
          series_id: string | null
          status: string
          variant_index: number | null
        }
        Insert: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          error?: string | null
          id?: string
          image_id?: string | null
          job_id: string
          job_type?: string
          series_id?: string | null
          status?: string
          variant_index?: number | null
        }
        Update: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          error?: string | null
          id?: string
          image_id?: string | null
          job_id?: string
          job_type?: string
          series_id?: string | null
          status?: string
          variant_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "story_series"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          character_id: string | null
          created_at: string
          critique: string | null
          id: string
          mode: string
          negative_prompt: string
          nsfw_url: string | null
          prompt: string
          settings: Json
          sfw_url: string | null
          stored_url: string | null
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          critique?: string | null
          id?: string
          mode?: string
          negative_prompt?: string
          nsfw_url?: string | null
          prompt: string
          settings?: Json
          sfw_url?: string | null
          stored_url?: string | null
        }
        Update: {
          character_id?: string | null
          created_at?: string
          critique?: string | null
          id?: string
          mode?: string
          negative_prompt?: string
          nsfw_url?: string | null
          prompt?: string
          settings?: Json
          sfw_url?: string | null
          stored_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "images_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      nsw_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          payment_provider: string | null
          provider_payment_id: string | null
          status: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          payment_provider?: string | null
          provider_payment_id?: string | null
          status: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          payment_provider?: string | null
          provider_payment_id?: string | null
          status?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nsw_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "nsw_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nsw_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "nsw_users"
            referencedColumns: ["id"]
          },
        ]
      }
      nsw_purchases: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          payment_id: string | null
          series_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          payment_id?: string | null
          series_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          payment_id?: string | null
          series_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nsw_purchases_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "nsw_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nsw_purchases_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "story_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nsw_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "nsw_users"
            referencedColumns: ["id"]
          },
        ]
      }
      nsw_subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          ends_at: string | null
          id: string
          is_founding_member: boolean
          locked_rate_cents: number | null
          payfast_token: string | null
          plan: string
          rate_locked_until: string | null
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          ends_at?: string | null
          id?: string
          is_founding_member?: boolean
          locked_rate_cents?: number | null
          payfast_token?: string | null
          plan: string
          rate_locked_until?: string | null
          starts_at: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          ends_at?: string | null
          id?: string
          is_founding_member?: boolean
          locked_rate_cents?: number | null
          payfast_token?: string | null
          plan?: string
          rate_locked_until?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nsw_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "nsw_users"
            referencedColumns: ["id"]
          },
        ]
      }
      nsw_users: {
        Row: {
          auth_user_id: string
          both_channels_bonus: boolean
          created_at: string
          display_name: string | null
          email: string
          has_email: boolean
          has_whatsapp: boolean
          id: string
          nurture_started_at: string | null
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          both_channels_bonus?: boolean
          created_at?: string
          display_name?: string | null
          email: string
          has_email?: boolean
          has_whatsapp?: boolean
          id?: string
          nurture_started_at?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          both_channels_bonus?: boolean
          created_at?: string
          display_name?: string | null
          email?: string
          has_email?: boolean
          has_whatsapp?: boolean
          id?: string
          nurture_started_at?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      page_views: {
        Row: {
          browser: string | null
          country_code: string | null
          created_at: string | null
          device_type: string | null
          id: string
          is_new_session: boolean | null
          os: string | null
          page_path: string
          page_title: string | null
          referrer: string | null
          referrer_domain: string | null
          response_time_ms: number | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          browser?: string | null
          country_code?: string | null
          created_at?: string | null
          device_type?: string | null
          id?: string
          is_new_session?: boolean | null
          os?: string | null
          page_path: string
          page_title?: string | null
          referrer?: string | null
          referrer_domain?: string | null
          response_time_ms?: number | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          browser?: string | null
          country_code?: string | null
          created_at?: string | null
          device_type?: string | null
          id?: string
          is_new_session?: boolean | null
          os?: string | null
          page_path?: string
          page_title?: string | null
          referrer?: string | null
          referrer_domain?: string | null
          response_time_ms?: number | null
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      payfast_itn_events: {
        Row: {
          m_payment_id: string | null
          payment_status: string | null
          pf_payment_id: string
          raw_payload: Json
          received_at: string
        }
        Insert: {
          m_payment_id?: string | null
          payment_status?: string | null
          pf_payment_id: string
          raw_payload: Json
          received_at?: string
        }
        Update: {
          m_payment_id?: string | null
          payment_status?: string | null
          pf_payment_id?: string
          raw_payload?: Json
          received_at?: string
        }
        Relationships: []
      }
      pose_templates: {
        Row: {
          created_at: string
          id: string
          image_id: string
          name: string
          pose_description: string
          send_image_to_model: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_id: string
          name: string
          pose_description: string
          send_image_to_model?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_id?: string
          name?: string
          pose_description?: string
          send_image_to_model?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pose_templates_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          browser: string | null
          country_code: string | null
          device_type: string | null
          first_seen: string | null
          last_seen: string | null
          os: string | null
          page_count: number | null
          session_id: string
        }
        Insert: {
          browser?: string | null
          country_code?: string | null
          device_type?: string | null
          first_seen?: string | null
          last_seen?: string | null
          os?: string | null
          page_count?: number | null
          session_id: string
        }
        Update: {
          browser?: string | null
          country_code?: string | null
          device_type?: string | null
          first_seen?: string | null
          last_seen?: string | null
          os?: string | null
          page_count?: number | null
          session_id?: string
        }
        Relationships: []
      }
      story_characters: {
        Row: {
          character_id: string
          id: string
          prose_description: string | null
          role: string | null
          series_id: string
        }
        Insert: {
          character_id: string
          id?: string
          prose_description?: string | null
          role?: string | null
          series_id: string
        }
        Update: {
          character_id?: string
          id?: string
          prose_description?: string | null
          role?: string | null
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_characters_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_characters_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "story_series"
            referencedColumns: ["id"]
          },
        ]
      }
      story_image_prompts: {
        Row: {
          character_block_override: string | null
          character_id: string | null
          character_name: string | null
          clothing_override: string | null
          created_at: string
          debug_data: Json | null
          final_prompt: string | null
          final_prompt_drafted_at: string | null
          id: string
          image_id: string | null
          image_type: string
          is_chapter_hero: boolean
          pairs_with: string | null
          pose_template_id: string | null
          position: number
          position_after_word: number | null
          post_id: string
          previous_image_id: string | null
          prompt: string
          secondary_character_block_override: string | null
          secondary_character_id: string | null
          secondary_character_name: string | null
          sfw_constraint_override: string | null
          sfw_image_id: string | null
          status: string
          suppress_character_block: boolean
          updated_at: string
          visual_signature_override: string | null
        }
        Insert: {
          character_block_override?: string | null
          character_id?: string | null
          character_name?: string | null
          clothing_override?: string | null
          created_at?: string
          debug_data?: Json | null
          final_prompt?: string | null
          final_prompt_drafted_at?: string | null
          id?: string
          image_id?: string | null
          image_type: string
          is_chapter_hero?: boolean
          pairs_with?: string | null
          pose_template_id?: string | null
          position?: number
          position_after_word?: number | null
          post_id: string
          previous_image_id?: string | null
          prompt: string
          secondary_character_block_override?: string | null
          secondary_character_id?: string | null
          secondary_character_name?: string | null
          sfw_constraint_override?: string | null
          sfw_image_id?: string | null
          status?: string
          suppress_character_block?: boolean
          updated_at?: string
          visual_signature_override?: string | null
        }
        Update: {
          character_block_override?: string | null
          character_id?: string | null
          character_name?: string | null
          clothing_override?: string | null
          created_at?: string
          debug_data?: Json | null
          final_prompt?: string | null
          final_prompt_drafted_at?: string | null
          id?: string
          image_id?: string | null
          image_type?: string
          is_chapter_hero?: boolean
          pairs_with?: string | null
          pose_template_id?: string | null
          position?: number
          position_after_word?: number | null
          post_id?: string
          previous_image_id?: string | null
          prompt?: string
          secondary_character_block_override?: string | null
          secondary_character_id?: string | null
          secondary_character_name?: string | null
          sfw_constraint_override?: string | null
          sfw_image_id?: string | null
          status?: string
          suppress_character_block?: boolean
          updated_at?: string
          visual_signature_override?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "story_image_prompts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_pairs_with_fkey"
            columns: ["pairs_with"]
            isOneToOne: false
            referencedRelation: "story_image_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_pose_template_id_fkey"
            columns: ["pose_template_id"]
            isOneToOne: false
            referencedRelation: "pose_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "story_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_previous_image_id_fkey"
            columns: ["previous_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_secondary_character_id_fkey"
            columns: ["secondary_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_image_prompts_sfw_image_id_fkey"
            columns: ["sfw_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      story_posts: {
        Row: {
          created_at: string
          facebook_comment: string | null
          facebook_content: string
          facebook_post_id: string | null
          facebook_teaser: string | null
          hashtags: string[] | null
          id: string
          part_number: number
          published_at: string | null
          scheduled_for: string | null
          series_id: string
          status: string
          title: string
          updated_at: string
          website_content: string
        }
        Insert: {
          created_at?: string
          facebook_comment?: string | null
          facebook_content: string
          facebook_post_id?: string | null
          facebook_teaser?: string | null
          hashtags?: string[] | null
          id?: string
          part_number: number
          published_at?: string | null
          scheduled_for?: string | null
          series_id: string
          status?: string
          title: string
          updated_at?: string
          website_content: string
        }
        Update: {
          created_at?: string
          facebook_comment?: string | null
          facebook_content?: string
          facebook_post_id?: string | null
          facebook_teaser?: string | null
          hashtags?: string[] | null
          id?: string
          part_number?: number
          published_at?: string | null
          scheduled_for?: string | null
          series_id?: string
          status?: string
          title?: string
          updated_at?: string
          website_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_posts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "story_series"
            referencedColumns: ["id"]
          },
        ]
      }
      story_series: {
        Row: {
          author_notes: Json | null
          blurb_long_selected: number | null
          blurb_long_variants: Json | null
          blurb_short_selected: number | null
          blurb_short_variants: Json | null
          cover_base_url: string | null
          cover_error: string | null
          cover_prompt: string | null
          cover_secondary_character_id: string | null
          cover_selected_variant: number | null
          cover_sizes: Json | null
          cover_status: string
          cover_variants: Json | null
          created_at: string
          description: string | null
          hashtag: string | null
          id: string
          image_engine: string
          image_model: string
          marketing: Json | null
          slug: string
          status: string
          title: string
          total_parts: number
          updated_at: string
        }
        Insert: {
          author_notes?: Json | null
          blurb_long_selected?: number | null
          blurb_long_variants?: Json | null
          blurb_short_selected?: number | null
          blurb_short_variants?: Json | null
          cover_base_url?: string | null
          cover_error?: string | null
          cover_prompt?: string | null
          cover_secondary_character_id?: string | null
          cover_selected_variant?: number | null
          cover_sizes?: Json | null
          cover_status?: string
          cover_variants?: Json | null
          created_at?: string
          description?: string | null
          hashtag?: string | null
          id?: string
          image_engine?: string
          image_model?: string
          marketing?: Json | null
          slug: string
          status?: string
          title: string
          total_parts?: number
          updated_at?: string
        }
        Update: {
          author_notes?: Json | null
          blurb_long_selected?: number | null
          blurb_long_variants?: Json | null
          blurb_short_selected?: number | null
          blurb_short_variants?: Json | null
          cover_base_url?: string | null
          cover_error?: string | null
          cover_prompt?: string | null
          cover_secondary_character_id?: string | null
          cover_selected_variant?: number | null
          cover_sizes?: Json | null
          cover_status?: string
          cover_variants?: Json | null
          created_at?: string
          description?: string | null
          hashtag?: string | null
          id?: string
          image_engine?: string
          image_model?: string
          marketing?: Json | null
          slug?: string
          status?: string
          title?: string
          total_parts?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_series_cover_secondary_character_id_fkey"
            columns: ["cover_secondary_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_pins: {
        Row: {
          attempts: number
          chapter: number
          created_at: string
          expires_at: string
          id: string
          locked_until: string | null
          phone: string
          pin: string
          story_slug: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          chapter: number
          created_at?: string
          expires_at: string
          id?: string
          locked_until?: string | null
          phone: string
          pin: string
          story_slug: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          chapter?: number
          created_at?: string
          expires_at?: string
          id?: string
          locked_until?: string | null
          phone?: string
          pin?: string
          story_slug?: string
          verified_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      current_blocked_users: {
        Row: {
          blocked_at: string | null
          minutes_remaining: number | null
          phone_number: string | null
          reason: string | null
          status: string | null
          unblock_at: string | null
        }
        Insert: {
          blocked_at?: string | null
          minutes_remaining?: never
          phone_number?: string | null
          reason?: string | null
          status?: never
          unblock_at?: string | null
        }
        Update: {
          blocked_at?: string | null
          minutes_remaining?: never
          phone_number?: string | null
          reason?: string | null
          status?: never
          unblock_at?: string | null
        }
        Relationships: []
      }
      daily_active_users: {
        Row: {
          active_users: number | null
          avg_time_on_page: number | null
          date: string | null
          total_events: number | null
        }
        Relationships: []
      }
      feature_popularity: {
        Row: {
          avg_minutes_used: number | null
          feature_name: string | null
          last_used: string | null
          total_uses: number | null
          unique_users: number | null
        }
        Relationships: []
      }
      pricing_by_gateway: {
        Row: {
          billing_currency_code: string | null
          country_count: number | null
          max_professional: number | null
          max_starter: number | null
          min_professional: number | null
          min_starter: number | null
          payment_gateway: string | null
        }
        Relationships: []
      }
      recent_security_threats: {
        Row: {
          blocked_messages: number | null
          command_attempts: number | null
          critical_threats: number | null
          date: string | null
          script_attempts: number | null
          sql_attempts: number | null
          unique_attackers: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_net_amount: {
        Args: {
          gross_amount: number
          payfast_fee?: number
          platform_fee?: number
        }
        Returns: number
      }
      calculate_payfast_fee: { Args: { amount: number }; Returns: number }
      calculate_video_performance_score: {
        Args: {
          p_completion_rate: number
          p_engagement_rate: number
          p_share_count: number
          p_view_count: number
        }
        Returns: number
      }
      can_auto_approve: {
        Args: { p_amount: number; p_client_id: string; p_trainer_id: string }
        Returns: boolean
      }
      check_token_limits: {
        Args: { p_amount: number; p_token_id: string }
        Returns: boolean
      }
      cleanup_abandoned_links: { Args: never; Returns: number }
      cleanup_expired_assessment_tokens: { Args: never; Returns: undefined }
      cleanup_expired_dashboard_tokens: { Args: never; Returns: undefined }
      cleanup_expired_flow_tokens: { Args: never; Returns: undefined }
      cleanup_expired_pending_bookings: { Args: never; Returns: undefined }
      cleanup_expired_registrations: { Args: never; Returns: undefined }
      cleanup_expired_token_setup: { Args: never; Returns: undefined }
      cleanup_old_processed_messages: { Args: never; Returns: undefined }
      cleanup_old_verifications: { Args: never; Returns: undefined }
      expire_old_registration_sessions: { Args: never; Returns: undefined }
      get_country_pricing: {
        Args: { p_country_code: string }
        Returns: {
          billing_currency_code: string
          country_name: string
          payment_gateway: string
          professional_annual: number
          professional_monthly: number
          starter_annual: number
          starter_monthly: number
          studio_annual: number
          studio_monthly: number
        }[]
      }
      get_next_reminder_date: {
        Args: { reminder_day: number }
        Returns: string
      }
      get_payment_gateway: { Args: { p_country_code: string }; Returns: string }
      increment: { Args: { row_id: string; x: number }; Returns: number }
      mask_account_number: { Args: { account_number: string }; Returns: string }
      set_chapter_hero: {
        Args: { p_post_id: string; p_prompt_id: string }
        Returns: undefined
      }
      verify_trainer_client_relationship: {
        Args: { p_client_id: string; p_trainer_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
