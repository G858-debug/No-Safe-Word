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
      achievements: {
        Row: {
          achievement_name: string
          achievement_type: string
          client_id: string
          created_at: string | null
          description: string | null
          id: string
          points_awarded: number | null
          trainer_id: string
          unlocked_at: string | null
        }
        Insert: {
          achievement_name: string
          achievement_type: string
          client_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          points_awarded?: number | null
          trainer_id: string
          unlocked_at?: string | null
        }
        Update: {
          achievement_name?: string
          achievement_type?: string
          client_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          points_awarded?: number | null
          trainer_id?: string
          unlocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "achievements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievements_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          activity_data: Json | null
          activity_type: string
          created_at: string | null
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
          user_type: string
        }
        Insert: {
          activity_data?: Json | null
          activity_type: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
          user_type: string
        }
        Update: {
          activity_data?: Json | null
          activity_type?: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
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
      assessment_access_tokens: {
        Row: {
          client_id: string | null
          created_at: string | null
          expires_at: string
          id: string
          last_accessed: string | null
          token: string
          used_count: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          last_accessed?: string | null
          token: string
          used_count?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          last_accessed?: string | null
          token?: string
          used_count?: number | null
        }
        Relationships: []
      }
      assessment_photos: {
        Row: {
          assessment_id: string | null
          caption: string | null
          client_id: string | null
          id: string
          is_deleted: boolean | null
          photo_type: string | null
          photo_url: string
          thumbnail_url: string | null
          uploaded_at: string | null
        }
        Insert: {
          assessment_id?: string | null
          caption?: string | null
          client_id?: string | null
          id?: string
          is_deleted?: boolean | null
          photo_type?: string | null
          photo_url: string
          thumbnail_url?: string | null
          uploaded_at?: string | null
        }
        Update: {
          assessment_id?: string | null
          caption?: string | null
          client_id?: string | null
          id?: string
          is_deleted?: boolean | null
          photo_type?: string | null
          photo_url?: string
          thumbnail_url?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_photos_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "fitness_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_reminders: {
        Row: {
          client_id: string | null
          created_at: string | null
          due_date: string
          id: string
          reminder_type: string | null
          sent_at: string | null
          status: string | null
          template_id: string | null
          trainer_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          due_date: string
          id?: string
          reminder_type?: string | null
          sent_at?: string | null
          status?: string | null
          template_id?: string | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          due_date?: string
          id?: string
          reminder_type?: string | null
          sent_at?: string | null
          status?: string | null
          template_id?: string | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_reminders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "assessment_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_templates: {
        Row: {
          completed_by: string | null
          created_at: string | null
          frequency: string | null
          goals_questions: Json | null
          health_questions: Json | null
          id: string
          include_goals: boolean | null
          include_health: boolean | null
          include_lifestyle: boolean | null
          include_measurements: boolean | null
          include_photos: boolean | null
          include_tests: boolean | null
          is_active: boolean | null
          lifestyle_questions: Json | null
          measurement_fields: Json | null
          next_due_date: string | null
          send_reminders: boolean | null
          template_name: string | null
          test_fields: Json | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          completed_by?: string | null
          created_at?: string | null
          frequency?: string | null
          goals_questions?: Json | null
          health_questions?: Json | null
          id?: string
          include_goals?: boolean | null
          include_health?: boolean | null
          include_lifestyle?: boolean | null
          include_measurements?: boolean | null
          include_photos?: boolean | null
          include_tests?: boolean | null
          is_active?: boolean | null
          lifestyle_questions?: Json | null
          measurement_fields?: Json | null
          next_due_date?: string | null
          send_reminders?: boolean | null
          template_name?: string | null
          test_fields?: Json | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          completed_by?: string | null
          created_at?: string | null
          frequency?: string | null
          goals_questions?: Json | null
          health_questions?: Json | null
          id?: string
          include_goals?: boolean | null
          include_health?: boolean | null
          include_lifestyle?: boolean | null
          include_measurements?: boolean | null
          include_photos?: boolean | null
          include_tests?: boolean | null
          is_active?: boolean | null
          lifestyle_questions?: Json | null
          measurement_fields?: Json | null
          next_due_date?: string | null
          send_reminders?: boolean | null
          template_name?: string | null
          test_fields?: Json | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      assessments: {
        Row: {
          answers: Json
          assessment_type: string
          client_id: string
          completed_at: string | null
          created_at: string | null
          id: string
          questions: Json
          score: number | null
          updated_at: string | null
        }
        Insert: {
          answers?: Json
          assessment_type: string
          client_id: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          questions?: Json
          score?: number | null
          updated_at?: string | null
        }
        Update: {
          answers?: Json
          assessment_type?: string
          client_id?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          questions?: Json
          score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      avatar_looks: {
        Row: {
          created_at: string
          group_id: string | null
          has_motion: boolean | null
          id: string
          image_keys: Json | null
          image_urls: Json | null
          look_config: Json | null
          look_id: string
          look_type: string
          motion_id: string | null
          motion_prompt: string | null
          motion_type: string | null
          photo_avatar_id: string | null
          preview_url: string | null
          prompt: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id?: string | null
          has_motion?: boolean | null
          id?: string
          image_keys?: Json | null
          image_urls?: Json | null
          look_config?: Json | null
          look_id: string
          look_type: string
          motion_id?: string | null
          motion_prompt?: string | null
          motion_type?: string | null
          photo_avatar_id?: string | null
          preview_url?: string | null
          prompt?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string | null
          has_motion?: boolean | null
          id?: string
          image_keys?: Json | null
          image_urls?: Json | null
          look_config?: Json | null
          look_id?: string
          look_type?: string
          motion_id?: string | null
          motion_prompt?: string | null
          motion_type?: string | null
          photo_avatar_id?: string | null
          preview_url?: string | null
          prompt?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      badge_definitions: {
        Row: {
          category: string
          created_at: string | null
          criteria_habit_type: string | null
          criteria_type: string
          criteria_value: number | null
          description: string | null
          emoji: string
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          trainer_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          criteria_habit_type?: string | null
          criteria_type: string
          criteria_value?: number | null
          description?: string | null
          emoji: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          trainer_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          criteria_habit_type?: string | null
          criteria_type?: string
          criteria_value?: number | null
          description?: string | null
          emoji?: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badge_definitions_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_payments: {
        Row: {
          amount: number
          booking_id: string
          client_id: string
          created_at: string | null
          currency: string | null
          id: string
          paid_at: string | null
          payfast_data: Json | null
          payfast_payment_id: string | null
          payment_method: string | null
          payment_status: string | null
          refunded_at: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          client_id: string
          created_at?: string | null
          currency?: string | null
          id?: string
          paid_at?: string | null
          payfast_data?: Json | null
          payfast_payment_id?: string | null
          payment_method?: string | null
          payment_status?: string | null
          refunded_at?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          client_id?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          paid_at?: string | null
          payfast_data?: Json | null
          payfast_payment_id?: string | null
          payment_method?: string | null
          payment_status?: string | null
          refunded_at?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_reminders: {
        Row: {
          booking_id: string
          client_id: string
          created_at: string | null
          id: string
          reminder_type: string
          scheduled_at: string
          sent_at: string | null
          status: string | null
          trainer_id: string
        }
        Insert: {
          booking_id: string
          client_id: string
          created_at?: string | null
          id?: string
          reminder_type: string
          scheduled_at: string
          sent_at?: string | null
          status?: string | null
          trainer_id: string
        }
        Update: {
          booking_id?: string
          client_id?: string
          created_at?: string | null
          id?: string
          reminder_type?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string | null
          trainer_id?: string
        }
        Relationships: []
      }
      booking_waitlist: {
        Row: {
          client_id: string
          created_at: string | null
          id: string
          preferred_times: string[] | null
          requested_date: string
          requested_time: string | null
          status: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          id?: string
          preferred_times?: string[] | null
          requested_date: string
          requested_time?: string | null
          status?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          id?: string
          preferred_times?: string[] | null
          requested_date?: string
          requested_time?: string | null
          status?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string
          completed_at: string | null
          completion_notes: string | null
          created_at: string | null
          duration_minutes: number | null
          group_class_id: string | null
          id: string
          monthly_billed: boolean | null
          notes: string | null
          payfast_payment_id: string | null
          payment_amount: number | null
          payment_currency: string | null
          payment_id: string | null
          payment_status: string | null
          price: number
          recurring_booking_id: string | null
          rescheduled_at: string | null
          session_date: string | null
          session_datetime: string
          session_notes: string | null
          session_time: string | null
          session_type: string | null
          status: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id: string
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          group_class_id?: string | null
          id?: string
          monthly_billed?: boolean | null
          notes?: string | null
          payfast_payment_id?: string | null
          payment_amount?: number | null
          payment_currency?: string | null
          payment_id?: string | null
          payment_status?: string | null
          price: number
          recurring_booking_id?: string | null
          rescheduled_at?: string | null
          session_date?: string | null
          session_datetime: string
          session_notes?: string | null
          session_time?: string | null
          session_type?: string | null
          status?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          group_class_id?: string | null
          id?: string
          monthly_billed?: boolean | null
          notes?: string | null
          payfast_payment_id?: string | null
          payment_amount?: number | null
          payment_currency?: string | null
          payment_id?: string | null
          payment_status?: string | null
          price?: number
          recurring_booking_id?: string | null
          rescheduled_at?: string | null
          session_date?: string | null
          session_datetime?: string
          session_notes?: string | null
          session_time?: string | null
          session_type?: string | null
          status?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          booking_id: string
          created_at: string | null
          external_event_id: string
          id: string
          provider: string
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          external_event_id: string
          id?: string
          provider: string
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          external_event_id?: string
          id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_exceptions: {
        Row: {
          all_day: boolean | null
          created_at: string | null
          end_time: string | null
          exception_date: string
          exception_type: string | null
          id: string
          reason: string | null
          start_time: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          all_day?: boolean | null
          created_at?: string | null
          end_time?: string | null
          exception_date: string
          exception_type?: string | null
          id?: string
          reason?: string | null
          start_time?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          all_day?: boolean | null
          created_at?: string | null
          end_time?: string | null
          exception_date?: string
          exception_type?: string | null
          id?: string
          reason?: string | null
          start_time?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      calendar_sync_preferences: {
        Row: {
          auto_create_events: boolean | null
          created_at: string | null
          event_title_template: string | null
          google_calendar_enabled: boolean | null
          id: string
          outlook_calendar_enabled: boolean | null
          sync_frequency: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          auto_create_events?: boolean | null
          created_at?: string | null
          event_title_template?: string | null
          google_calendar_enabled?: boolean | null
          id?: string
          outlook_calendar_enabled?: boolean | null
          sync_frequency?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          auto_create_events?: boolean | null
          created_at?: string | null
          event_title_template?: string | null
          google_calendar_enabled?: boolean | null
          id?: string
          outlook_calendar_enabled?: boolean | null
          sync_frequency?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_preferences_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_status: {
        Row: {
          created_at: string | null
          error_message: string | null
          events_synced: number | null
          id: string
          last_sync: string | null
          provider: string
          sync_status: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          events_synced?: number | null
          id?: string
          last_sync?: string | null
          provider: string
          sync_status?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          events_synced?: number | null
          id?: string
          last_sync?: string | null
          provider?: string
          sync_status?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_status_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_log: {
        Row: {
          booking_id: string
          cancelled_at: string | null
          cancelled_by: string
          client_id: string
          created_at: string | null
          id: string
          original_date: string | null
          original_time: string | null
          reason_code: string | null
          reason_text: string | null
          trainer_id: string
        }
        Insert: {
          booking_id: string
          cancelled_at?: string | null
          cancelled_by?: string
          client_id: string
          created_at?: string | null
          id?: string
          original_date?: string | null
          original_time?: string | null
          reason_code?: string | null
          reason_text?: string | null
          trainer_id: string
        }
        Update: {
          booking_id?: string
          cancelled_at?: string | null
          cancelled_by?: string
          client_id?: string
          created_at?: string | null
          id?: string
          original_date?: string | null
          original_time?: string | null
          reason_code?: string | null
          reason_text?: string | null
          trainer_id?: string
        }
        Relationships: []
      }
      challenge_daily_progress: {
        Row: {
          created_at: string | null
          date: string
          id: string
          participant_id: string
          target_met: boolean | null
          value_achieved: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          participant_id: string
          target_met?: boolean | null
          value_achieved?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          participant_id?: string
          target_met?: boolean | null
          value_achieved?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_daily_progress_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "challenge_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          client_id: string
          completed_at: string | null
          completion_percentage: number | null
          created_at: string | null
          current_score: number | null
          current_value: number | null
          days_completed: number | null
          id: string
          is_active: boolean | null
          joined_at: string | null
          last_check_in: string | null
          notes: string | null
          points_earned: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          challenge_id: string
          client_id: string
          completed_at?: string | null
          completion_percentage?: number | null
          created_at?: string | null
          current_score?: number | null
          current_value?: number | null
          days_completed?: number | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          last_check_in?: string | null
          notes?: string | null
          points_earned?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          challenge_id?: string
          client_id?: string
          completed_at?: string | null
          completion_percentage?: number | null
          created_at?: string | null
          current_score?: number | null
          current_value?: number | null
          days_completed?: number | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          last_check_in?: string | null
          notes?: string | null
          points_earned?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_participants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_progress: {
        Row: {
          challenge_id: string
          created_at: string | null
          date: string
          id: string
          participant_id: string
          points_earned: number | null
          updated_at: string | null
          value_achieved: number
        }
        Insert: {
          challenge_id: string
          created_at?: string | null
          date?: string
          id?: string
          participant_id: string
          points_earned?: number | null
          updated_at?: string | null
          value_achieved?: number
        }
        Update: {
          challenge_id?: string
          created_at?: string | null
          date?: string
          id?: string
          participant_id?: string
          points_earned?: number | null
          updated_at?: string | null
          value_achieved?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_progress_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_progress_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "challenge_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_progress_log: {
        Row: {
          challenge_id: string | null
          check_in_date: string
          completed: boolean | null
          created_at: string | null
          day_number: number
          id: string
          notes: string | null
          participant_id: string | null
        }
        Insert: {
          challenge_id?: string | null
          check_in_date?: string
          completed?: boolean | null
          created_at?: string | null
          day_number: number
          id?: string
          notes?: string | null
          participant_id?: string | null
        }
        Update: {
          challenge_id?: string | null
          check_in_date?: string
          completed?: boolean | null
          created_at?: string | null
          day_number?: number
          id?: string
          notes?: string | null
          participant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_progress_log_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_progress_log_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "challenge_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          challenge_rules: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          is_active: boolean | null
          max_participants: number | null
          name: string
          points_reward: number
          start_date: string
          status: string | null
          target_value: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          challenge_rules?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date: string
          id?: string
          is_active?: boolean | null
          max_participants?: number | null
          name: string
          points_reward?: number
          start_date: string
          status?: string | null
          target_value?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          challenge_rules?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string
          id?: string
          is_active?: boolean | null
          max_participants?: number | null
          name?: string
          points_reward?: number
          start_date?: string
          status?: string | null
          target_value?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      character_loras: {
        Row: {
          base_model: string
          character_id: string
          completed_stage: string | null
          created_at: string
          dataset_size: number
          deployed_at: string | null
          error: string | null
          file_size_bytes: number | null
          filename: string
          id: string
          pipeline_type: string
          status: string
          storage_path: string
          storage_url: string | null
          training_attempts: number
          training_id: string | null
          training_params: Json
          training_provider: string
          trigger_word: string
          updated_at: string
          validation_score: number | null
        }
        Insert: {
          base_model?: string
          character_id: string
          completed_stage?: string | null
          created_at?: string
          dataset_size?: number
          deployed_at?: string | null
          error?: string | null
          file_size_bytes?: number | null
          filename: string
          id?: string
          pipeline_type?: string
          status?: string
          storage_path: string
          storage_url?: string | null
          training_attempts?: number
          training_id?: string | null
          training_params?: Json
          training_provider?: string
          trigger_word: string
          updated_at?: string
          validation_score?: number | null
        }
        Update: {
          base_model?: string
          character_id?: string
          completed_stage?: string | null
          created_at?: string
          dataset_size?: number
          deployed_at?: string | null
          error?: string | null
          file_size_bytes?: number | null
          filename?: string
          id?: string
          pipeline_type?: string
          status?: string
          storage_path?: string
          storage_url?: string | null
          training_attempts?: number
          training_id?: string | null
          training_params?: Json
          training_provider?: string
          trigger_word?: string
          updated_at?: string
          validation_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "character_loras_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          created_at: string
          description: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_badges: {
        Row: {
          badge_id: string
          client_id: string
          context: Json | null
          earned_at: string | null
          id: string
        }
        Insert: {
          badge_id: string
          client_id: string
          context?: Json | null
          earned_at?: string | null
          id?: string
        }
        Update: {
          badge_id?: string
          client_id?: string
          context?: Json | null
          earned_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badge_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_badges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_exercise_history: {
        Row: {
          client_id: string
          exercise_id: string
          id: string
          last_reps: string
          last_rest_seconds: number
          last_sets: number
          last_weight_kg: number | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          exercise_id: string
          id?: string
          last_reps: string
          last_rest_seconds: number
          last_sets: number
          last_weight_kg?: number | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          exercise_id?: string
          id?: string
          last_reps?: string
          last_rest_seconds?: number
          last_sets?: number
          last_weight_kg?: number | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_exercise_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_exercise_history_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_exercise_history_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_exercise_preferences: {
        Row: {
          avoided_exercises: Json | null
          client_id: string | null
          id: string
          muscle_group: string | null
          notes: string | null
          preferred_exercises: Json | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          avoided_exercises?: Json | null
          client_id?: string | null
          id?: string
          muscle_group?: string | null
          notes?: string | null
          preferred_exercises?: Json | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avoided_exercises?: Json | null
          client_id?: string | null
          id?: string
          muscle_group?: string | null
          notes?: string | null
          preferred_exercises?: Json | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      client_habit_assignments: {
        Row: {
          client_id: string
          created_at: string | null
          custom_habit_id: string | null
          ended_at: string | null
          frequency: string | null
          frequency_days: Json | null
          grace_period_days: number | null
          habit_type: string | null
          id: string
          is_active: boolean | null
          reminder_time: string | null
          source: string | null
          started_at: string | null
          target_value: number | null
          trainer_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          custom_habit_id?: string | null
          ended_at?: string | null
          frequency?: string | null
          frequency_days?: Json | null
          grace_period_days?: number | null
          habit_type?: string | null
          id?: string
          is_active?: boolean | null
          reminder_time?: string | null
          source?: string | null
          started_at?: string | null
          target_value?: number | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          custom_habit_id?: string | null
          ended_at?: string | null
          frequency?: string | null
          frequency_days?: Json | null
          grace_period_days?: number | null
          habit_type?: string | null
          id?: string
          is_active?: boolean | null
          reminder_time?: string | null
          source?: string | null
          started_at?: string | null
          target_value?: number | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_habit_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_habit_assignments_custom_habit_id_fkey"
            columns: ["custom_habit_id"]
            isOneToOne: false
            referencedRelation: "custom_habit_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_habit_assignments_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_habits: {
        Row: {
          client_id: string | null
          created_at: string | null
          custom_name: string | null
          end_date: string | null
          frequency: string | null
          id: string
          is_active: boolean | null
          reminder_time: string | null
          start_date: string | null
          target_value: number | null
          template_id: string | null
          trainer_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          custom_name?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          reminder_time?: string | null
          start_date?: string | null
          target_value?: number | null
          template_id?: string | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          custom_name?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          reminder_time?: string | null
          start_date?: string | null
          target_value?: number | null
          template_id?: string | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_habits_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "habit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invitations: {
        Row: {
          accepted_at: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string
          created_at: string | null
          custom_price: number | null
          expires_at: string | null
          has_package_deal: boolean | null
          id: string
          invitation_method: string | null
          invitation_token: string
          message: string | null
          package_deal: Json | null
          package_deal_details: Json | null
          prefilled_data: Json | null
          price_discussion_status: string | null
          profile_completion_method: string | null
          selected_price: number | null
          status: string | null
          trainer_id: string
          trainer_provided_data: Json | null
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone: string
          created_at?: string | null
          custom_price?: number | null
          expires_at?: string | null
          has_package_deal?: boolean | null
          id?: string
          invitation_method?: string | null
          invitation_token: string
          message?: string | null
          package_deal?: Json | null
          package_deal_details?: Json | null
          prefilled_data?: Json | null
          price_discussion_status?: string | null
          profile_completion_method?: string | null
          selected_price?: number | null
          status?: string | null
          trainer_id: string
          trainer_provided_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string
          created_at?: string | null
          custom_price?: number | null
          expires_at?: string | null
          has_package_deal?: boolean | null
          id?: string
          invitation_method?: string | null
          invitation_token?: string
          message?: string | null
          package_deal?: Json | null
          package_deal_details?: Json | null
          prefilled_data?: Json | null
          price_discussion_status?: string | null
          profile_completion_method?: string | null
          selected_price?: number | null
          status?: string | null
          trainer_id?: string
          trainer_provided_data?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_invitations_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_consents: {
        Row: {
          auto_approve_payments: boolean | null
          client_id: string | null
          consent_date: string | null
          consent_given: boolean | null
          consent_whatsapp_message: string | null
          created_at: string | null
          id: string
          max_auto_approve_amount: number | null
          preferred_payment_day: number | null
          preferred_payment_method: string | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          auto_approve_payments?: boolean | null
          client_id?: string | null
          consent_date?: string | null
          consent_given?: boolean | null
          consent_whatsapp_message?: string | null
          created_at?: string | null
          id?: string
          max_auto_approve_amount?: number | null
          preferred_payment_day?: number | null
          preferred_payment_method?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_approve_payments?: boolean | null
          client_id?: string | null
          consent_date?: string | null
          consent_given?: boolean | null
          consent_whatsapp_message?: string | null
          created_at?: string | null
          id?: string
          max_auto_approve_amount?: number | null
          preferred_payment_day?: number | null
          preferred_payment_method?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      client_payment_preferences: {
        Row: {
          auto_approve_enabled: boolean | null
          auto_approve_max_amount: number | null
          client_id: string | null
          created_at: string | null
          id: string
          preferred_payment_day: number | null
          reminder_days_before: number | null
          require_itemized_invoice: boolean | null
          send_payment_receipts: boolean | null
          send_payment_reminders: boolean | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          auto_approve_enabled?: boolean | null
          auto_approve_max_amount?: number | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          preferred_payment_day?: number | null
          reminder_days_before?: number | null
          require_itemized_invoice?: boolean | null
          send_payment_receipts?: boolean | null
          send_payment_reminders?: boolean | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_approve_enabled?: boolean | null
          auto_approve_max_amount?: number | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          preferred_payment_day?: number | null
          reminder_days_before?: number | null
          require_itemized_invoice?: boolean | null
          send_payment_receipts?: boolean | null
          send_payment_reminders?: boolean | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      client_payment_tokens: {
        Row: {
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_holder_name: string | null
          card_last_four: string | null
          client_id: string | null
          consent_date: string | null
          consent_given: boolean | null
          consent_message: string | null
          created_at: string | null
          created_via: string | null
          deleted_at: string | null
          id: string
          is_default: boolean | null
          last_transaction_date: string | null
          last_verified_date: string | null
          max_amount_per_transaction: number | null
          max_transactions_per_month: number | null
          payfast_token: string
          payfast_token_status: string | null
          suspended_at: string | null
          suspended_reason: string | null
          trainer_id: string | null
          transactions_this_month: number | null
          updated_at: string | null
        }
        Insert: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_holder_name?: string | null
          card_last_four?: string | null
          client_id?: string | null
          consent_date?: string | null
          consent_given?: boolean | null
          consent_message?: string | null
          created_at?: string | null
          created_via?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean | null
          last_transaction_date?: string | null
          last_verified_date?: string | null
          max_amount_per_transaction?: number | null
          max_transactions_per_month?: number | null
          payfast_token: string
          payfast_token_status?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          trainer_id?: string | null
          transactions_this_month?: number | null
          updated_at?: string | null
        }
        Update: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_holder_name?: string | null
          card_last_four?: string | null
          client_id?: string | null
          consent_date?: string | null
          consent_given?: boolean | null
          consent_message?: string | null
          created_at?: string | null
          created_via?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean | null
          last_transaction_date?: string | null
          last_verified_date?: string | null
          max_amount_per_transaction?: number | null
          max_transactions_per_month?: number | null
          payfast_token?: string
          payfast_token_status?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          trainer_id?: string | null
          transactions_this_month?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      client_tasks: {
        Row: {
          client_phone: string
          completed_at: string | null
          created_at: string | null
          id: string
          started_at: string | null
          task_data: Json | null
          task_status: string | null
          task_type: string
          updated_at: string | null
        }
        Insert: {
          client_phone: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          started_at?: string | null
          task_data?: Json | null
          task_status?: string | null
          task_type: string
          updated_at?: string | null
        }
        Update: {
          client_phone?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          started_at?: string | null
          task_data?: Json | null
          task_status?: string | null
          task_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      client_trainer_list: {
        Row: {
          approved_at: string | null
          client_id: string
          connection_status: string | null
          created_at: string | null
          id: string
          invitation_token: string | null
          invited_at: string | null
          invited_by: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          client_id: string
          connection_status?: string | null
          created_at?: string | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          client_id?: string
          connection_status?: string | null
          created_at?: string | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          additional_notes: string | null
          approved_at: string | null
          availability: string | null
          client_id: string | null
          connection_status: string | null
          created_at: string | null
          current_package: string | null
          custom_price_per_session: number | null
          email: string | null
          experience_level: string | null
          fitness_goals: string | null
          health_conditions: string | null
          id: string
          invitation_token: string | null
          invited_at: string | null
          last_session_date: string | null
          name: string
          package_type: string | null
          preferred_training_times: string | null
          requested_by: string | null
          session_preferences: Json | null
          sessions_remaining: number | null
          status: string | null
          trainer_id: string | null
          updated_at: string | null
          whatsapp: string
        }
        Insert: {
          additional_notes?: string | null
          approved_at?: string | null
          availability?: string | null
          client_id?: string | null
          connection_status?: string | null
          created_at?: string | null
          current_package?: string | null
          custom_price_per_session?: number | null
          email?: string | null
          experience_level?: string | null
          fitness_goals?: string | null
          health_conditions?: string | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          last_session_date?: string | null
          name: string
          package_type?: string | null
          preferred_training_times?: string | null
          requested_by?: string | null
          session_preferences?: Json | null
          sessions_remaining?: number | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string | null
          whatsapp: string
        }
        Update: {
          additional_notes?: string | null
          approved_at?: string | null
          availability?: string | null
          client_id?: string | null
          connection_status?: string | null
          created_at?: string | null
          current_package?: string | null
          custom_price_per_session?: number | null
          email?: string | null
          experience_level?: string | null
          fitness_goals?: string | null
          health_conditions?: string | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          last_session_date?: string | null
          name?: string
          package_type?: string | null
          preferred_training_times?: string | null
          requested_by?: string | null
          session_preferences?: Json | null
          sessions_remaining?: number | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string | null
          whatsapp?: string
        }
        Relationships: []
      }
      clients_archive: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          availability: string | null
          created_at: string | null
          custom_price_per_session: number | null
          email: string | null
          fitness_goals: string | null
          id: string
          merge_target_id: string | null
          name: string | null
          package_type: string | null
          sessions_remaining: number | null
          status: string | null
          trainer_id: string | null
          whatsapp: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          availability?: string | null
          created_at?: string | null
          custom_price_per_session?: number | null
          email?: string | null
          fitness_goals?: string | null
          id: string
          merge_target_id?: string | null
          name?: string | null
          package_type?: string | null
          sessions_remaining?: number | null
          status?: string | null
          trainer_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          availability?: string | null
          created_at?: string | null
          custom_price_per_session?: number | null
          email?: string | null
          fitness_goals?: string | null
          id?: string
          merge_target_id?: string | null
          name?: string | null
          package_type?: string | null
          sessions_remaining?: number | null
          status?: string | null
          trainer_id?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      content_templates: {
        Row: {
          created_at: string | null
          example_output: string | null
          id: string
          is_active: boolean | null
          template_name: string
          template_structure: Json
          template_type: string | null
        }
        Insert: {
          created_at?: string | null
          example_output?: string | null
          id?: string
          is_active?: boolean | null
          template_name: string
          template_structure: Json
          template_type?: string | null
        }
        Update: {
          created_at?: string | null
          example_output?: string | null
          id?: string
          is_active?: boolean | null
          template_name?: string
          template_structure?: Json
          template_type?: string | null
        }
        Relationships: []
      }
      content_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      conversation_states: {
        Row: {
          context: Json | null
          created_at: string | null
          current_state: string | null
          current_task_id: string | null
          id: string
          last_activity: string | null
          last_intent: string | null
          login_status: string | null
          phone_number: string
          role_preference: string | null
          session_data: Json | null
          state: string | null
          state_data: Json | null
          updated_at: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          current_state?: string | null
          current_task_id?: string | null
          id?: string
          last_activity?: string | null
          last_intent?: string | null
          login_status?: string | null
          phone_number: string
          role_preference?: string | null
          session_data?: Json | null
          state?: string | null
          state_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          current_state?: string | null
          current_task_id?: string | null
          id?: string
          last_activity?: string | null
          last_intent?: string | null
          login_status?: string | null
          phone_number?: string
          role_preference?: string | null
          session_data?: Json | null
          state?: string | null
          state_data?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      country_pricing: {
        Row: {
          billing_currency_code: string
          country_code: string
          country_name: string
          created_at: string | null
          id: string
          income_level: string | null
          is_active: boolean | null
          local_currency_code: string
          local_currency_name: string
          payment_gateway: string
          professional_annual: number | null
          professional_monthly: number
          region: string | null
          starter_annual: number | null
          starter_monthly: number
          studio_annual: number | null
          studio_monthly: number
          updated_at: string | null
        }
        Insert: {
          billing_currency_code: string
          country_code: string
          country_name: string
          created_at?: string | null
          id?: string
          income_level?: string | null
          is_active?: boolean | null
          local_currency_code: string
          local_currency_name: string
          payment_gateway: string
          professional_annual?: number | null
          professional_monthly: number
          region?: string | null
          starter_annual?: number | null
          starter_monthly: number
          studio_annual?: number | null
          studio_monthly: number
          updated_at?: string | null
        }
        Update: {
          billing_currency_code?: string
          country_code?: string
          country_name?: string
          created_at?: string | null
          id?: string
          income_level?: string | null
          is_active?: boolean | null
          local_currency_code?: string
          local_currency_name?: string
          payment_gateway?: string
          professional_annual?: number | null
          professional_monthly?: number
          region?: string | null
          starter_annual?: number | null
          starter_monthly?: number
          studio_annual?: number | null
          studio_monthly?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      custom_habit_templates: {
        Row: {
          created_at: string | null
          default_target: number | null
          description: string | null
          emoji: string | null
          id: string
          is_active: boolean | null
          measurement_type: string
          name: string
          trainer_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          default_target?: number | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          measurement_type: string
          name: string
          trainer_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          default_target?: number | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          measurement_type?: string
          name?: string
          trainer_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_habit_templates_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_analytics: {
        Row: {
          api_response_time_ms: number | null
          browser: string | null
          created_at: string | null
          device_type: string | null
          event_data: Json | null
          event_name: string | null
          event_type: string | null
          id: string
          is_pwa: boolean | null
          load_time_ms: number | null
          os: string | null
          page_section: string | null
          screen_size: string | null
          session_id: string | null
          time_on_page: number | null
          trainer_id: string | null
        }
        Insert: {
          api_response_time_ms?: number | null
          browser?: string | null
          created_at?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_name?: string | null
          event_type?: string | null
          id?: string
          is_pwa?: boolean | null
          load_time_ms?: number | null
          os?: string | null
          page_section?: string | null
          screen_size?: string | null
          session_id?: string | null
          time_on_page?: number | null
          trainer_id?: string | null
        }
        Update: {
          api_response_time_ms?: number | null
          browser?: string | null
          created_at?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_name?: string | null
          event_type?: string | null
          id?: string
          is_pwa?: boolean | null
          load_time_ms?: number | null
          os?: string | null
          page_section?: string | null
          screen_size?: string | null
          session_id?: string | null
          time_on_page?: number | null
          trainer_id?: string | null
        }
        Relationships: []
      }
      dashboard_links: {
        Row: {
          access_count: number | null
          cache_updated_at: string | null
          cached_data: Json | null
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          last_accessed: string | null
          short_code: string
          trainer_id: string | null
        }
        Insert: {
          access_count?: number | null
          cache_updated_at?: string | null
          cached_data?: Json | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          last_accessed?: string | null
          short_code: string
          trainer_id?: string | null
        }
        Update: {
          access_count?: number | null
          cache_updated_at?: string | null
          cached_data?: Json | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          last_accessed?: string | null
          short_code?: string
          trainer_id?: string | null
        }
        Relationships: []
      }
      dashboard_notifications: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          notification_type: string | null
          trainer_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          notification_type?: string | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          notification_type?: string | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_notifications_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_stats: {
        Row: {
          active_clients: number | null
          created_at: string | null
          id: string
          revenue_amount: number | null
          sessions_cancelled: number | null
          sessions_completed: number | null
          stat_date: string
          total_clients: number | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          active_clients?: number | null
          created_at?: string | null
          id?: string
          revenue_amount?: number | null
          sessions_cancelled?: number | null
          sessions_completed?: number | null
          stat_date: string
          total_clients?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active_clients?: number | null
          created_at?: string | null
          id?: string
          revenue_amount?: number | null
          sessions_cancelled?: number | null
          sessions_completed?: number | null
          stat_date?: string
          total_clients?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_stats_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
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
      dashboard_tokens_backup: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          token: string
          trainer_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          token: string
          trainer_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          token?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_tokens_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          email: string | null
          error: string | null
          full_name: string | null
          id: string
          ip_address: string | null
          phone: string | null
          process_by: string | null
          reason: string | null
          requested_at: string | null
          status: string | null
          user_type: string | null
        }
        Insert: {
          completed_at?: string | null
          email?: string | null
          error?: string | null
          full_name?: string | null
          id?: string
          ip_address?: string | null
          phone?: string | null
          process_by?: string | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
          user_type?: string | null
        }
        Update: {
          completed_at?: string | null
          email?: string | null
          error?: string | null
          full_name?: string | null
          id?: string
          ip_address?: string | null
          phone?: string | null
          process_by?: string | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
          user_type?: string | null
        }
        Relationships: []
      }
      engagement_metrics: {
        Row: {
          avg_session_duration: number | null
          bounce_rate: number | null
          consecutive_days: number | null
          days_active: number | null
          exports_count: number | null
          first_visit: string | null
          id: string
          installed_pwa: boolean | null
          last_visit: string | null
          most_viewed_section: string | null
          opens_from_pwa: number | null
          preferred_device: string | null
          preferred_time: string | null
          pwa_install_date: string | null
          total_page_views: number | null
          total_sessions: number | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          avg_session_duration?: number | null
          bounce_rate?: number | null
          consecutive_days?: number | null
          days_active?: number | null
          exports_count?: number | null
          first_visit?: string | null
          id?: string
          installed_pwa?: boolean | null
          last_visit?: string | null
          most_viewed_section?: string | null
          opens_from_pwa?: number | null
          preferred_device?: string | null
          preferred_time?: string | null
          pwa_install_date?: string | null
          total_page_views?: number | null
          total_sessions?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avg_session_duration?: number | null
          bounce_rate?: number | null
          consecutive_days?: number | null
          days_active?: number | null
          exports_count?: number | null
          first_visit?: string | null
          id?: string
          installed_pwa?: boolean | null
          last_visit?: string | null
          most_viewed_section?: string | null
          opens_from_pwa?: number | null
          preferred_device?: string | null
          preferred_time?: string | null
          pwa_install_date?: string | null
          total_page_views?: number | null
          total_sessions?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exercises: {
        Row: {
          alternate_names: string[] | null
          category: string | null
          common_mistakes: string[] | null
          created_at: string | null
          difficulty: string | null
          equipment: string | null
          form_tips: string[] | null
          gif_url_female: string | null
          gif_url_male: string | null
          gif_url_neutral: string | null
          id: string
          instructions: string | null
          is_active: boolean | null
          is_bodyweight: boolean
          major_group: string | null
          muscle_group: string
          muscle_groups: string[] | null
          name: string
          subcategory: string | null
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          alternate_names?: string[] | null
          category?: string | null
          common_mistakes?: string[] | null
          created_at?: string | null
          difficulty?: string | null
          equipment?: string | null
          form_tips?: string[] | null
          gif_url_female?: string | null
          gif_url_male?: string | null
          gif_url_neutral?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          is_bodyweight?: boolean
          major_group?: string | null
          muscle_group: string
          muscle_groups?: string[] | null
          name: string
          subcategory?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          alternate_names?: string[] | null
          category?: string | null
          common_mistakes?: string[] | null
          created_at?: string | null
          difficulty?: string | null
          equipment?: string | null
          form_tips?: string[] | null
          gif_url_female?: string | null
          gif_url_male?: string | null
          gif_url_neutral?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          is_bodyweight?: boolean
          major_group?: string | null
          muscle_group?: string
          muscle_groups?: string[] | null
          name?: string
          subcategory?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      feature_usage: {
        Row: {
          created_at: string | null
          feature_name: string | null
          id: string
          last_used: string | null
          most_used_day: string | null
          peak_hour: number | null
          total_time_seconds: number | null
          trainer_id: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          created_at?: string | null
          feature_name?: string | null
          id?: string
          last_used?: string | null
          most_used_day?: string | null
          peak_hour?: number | null
          total_time_seconds?: number | null
          trainer_id?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          created_at?: string | null
          feature_name?: string | null
          id?: string
          last_used?: string | null
          most_used_day?: string | null
          peak_hour?: number | null
          total_time_seconds?: number | null
          trainer_id?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      fitness_assessments: {
        Row: {
          access_token: string | null
          alcohol_frequency: string | null
          assessment_date: string | null
          assessment_type: string | null
          chronic_conditions: string[] | null
          client_id: string | null
          client_notes: string | null
          completed_by: string | null
          created_at: string | null
          current_exercise_routine: string | null
          current_medications: string[] | null
          dietary_restrictions: string[] | null
          doctor_clearance: boolean | null
          doctor_clearance_notes: string | null
          due_date: string | null
          family_health_history: string | null
          form_completed_at: string | null
          form_opened_at: string | null
          id: string
          next_assessment_date: string | null
          nutrition_notes: string | null
          occupation: string | null
          pain_areas: string[] | null
          past_injuries: Json | null
          red_flags: string[] | null
          reminder_sent: boolean | null
          requires_medical_clearance: boolean | null
          responses: Json | null
          sleep_hours_per_night: number | null
          sleep_quality: string | null
          smoking_status: string | null
          status: string | null
          stress_level: number | null
          stress_management: string | null
          supplements: string[] | null
          surgeries: Json | null
          template_id: string | null
          token_expires_at: string | null
          trainer_id: string | null
          trainer_notes: string | null
          updated_at: string | null
          water_intake_liters: number | null
          work_activity_level: string | null
        }
        Insert: {
          access_token?: string | null
          alcohol_frequency?: string | null
          assessment_date?: string | null
          assessment_type?: string | null
          chronic_conditions?: string[] | null
          client_id?: string | null
          client_notes?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_exercise_routine?: string | null
          current_medications?: string[] | null
          dietary_restrictions?: string[] | null
          doctor_clearance?: boolean | null
          doctor_clearance_notes?: string | null
          due_date?: string | null
          family_health_history?: string | null
          form_completed_at?: string | null
          form_opened_at?: string | null
          id?: string
          next_assessment_date?: string | null
          nutrition_notes?: string | null
          occupation?: string | null
          pain_areas?: string[] | null
          past_injuries?: Json | null
          red_flags?: string[] | null
          reminder_sent?: boolean | null
          requires_medical_clearance?: boolean | null
          responses?: Json | null
          sleep_hours_per_night?: number | null
          sleep_quality?: string | null
          smoking_status?: string | null
          status?: string | null
          stress_level?: number | null
          stress_management?: string | null
          supplements?: string[] | null
          surgeries?: Json | null
          template_id?: string | null
          token_expires_at?: string | null
          trainer_id?: string | null
          trainer_notes?: string | null
          updated_at?: string | null
          water_intake_liters?: number | null
          work_activity_level?: string | null
        }
        Update: {
          access_token?: string | null
          alcohol_frequency?: string | null
          assessment_date?: string | null
          assessment_type?: string | null
          chronic_conditions?: string[] | null
          client_id?: string | null
          client_notes?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_exercise_routine?: string | null
          current_medications?: string[] | null
          dietary_restrictions?: string[] | null
          doctor_clearance?: boolean | null
          doctor_clearance_notes?: string | null
          due_date?: string | null
          family_health_history?: string | null
          form_completed_at?: string | null
          form_opened_at?: string | null
          id?: string
          next_assessment_date?: string | null
          nutrition_notes?: string | null
          occupation?: string | null
          pain_areas?: string[] | null
          past_injuries?: Json | null
          red_flags?: string[] | null
          reminder_sent?: boolean | null
          requires_medical_clearance?: boolean | null
          responses?: Json | null
          sleep_hours_per_night?: number | null
          sleep_quality?: string | null
          smoking_status?: string | null
          status?: string | null
          stress_level?: number | null
          stress_management?: string | null
          supplements?: string[] | null
          surgeries?: Json | null
          template_id?: string | null
          token_expires_at?: string | null
          trainer_id?: string | null
          trainer_notes?: string | null
          updated_at?: string | null
          water_intake_liters?: number | null
          work_activity_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fitness_assessments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "assessment_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      fitness_goals: {
        Row: {
          assessment_id: string | null
          client_id: string | null
          concerns: string | null
          confidence_level: number | null
          created_at: string | null
          exercise_dislikes: string[] | null
          exercise_likes: string[] | null
          failure_factors: string | null
          goal_description: string | null
          id: string
          motivation_level: number | null
          preferred_training_style: string[] | null
          previous_experience: string | null
          primary_goal: string | null
          specific_targets: Json | null
          success_factors: string | null
          support_system: string | null
          timeline_weeks: number | null
        }
        Insert: {
          assessment_id?: string | null
          client_id?: string | null
          concerns?: string | null
          confidence_level?: number | null
          created_at?: string | null
          exercise_dislikes?: string[] | null
          exercise_likes?: string[] | null
          failure_factors?: string | null
          goal_description?: string | null
          id?: string
          motivation_level?: number | null
          preferred_training_style?: string[] | null
          previous_experience?: string | null
          primary_goal?: string | null
          specific_targets?: Json | null
          success_factors?: string | null
          support_system?: string | null
          timeline_weeks?: number | null
        }
        Update: {
          assessment_id?: string | null
          client_id?: string | null
          concerns?: string | null
          confidence_level?: number | null
          created_at?: string | null
          exercise_dislikes?: string[] | null
          exercise_likes?: string[] | null
          failure_factors?: string | null
          goal_description?: string | null
          id?: string
          motivation_level?: number | null
          preferred_training_style?: string[] | null
          previous_experience?: string | null
          primary_goal?: string | null
          specific_targets?: Json | null
          success_factors?: string | null
          support_system?: string | null
          timeline_weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fitness_goals_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "fitness_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      fitness_habits: {
        Row: {
          created_at: string | null
          description: string | null
          frequency: string
          habit_id: string
          habit_name: string
          id: string
          is_active: boolean | null
          target_value: number
          trainer_id: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          frequency?: string
          habit_id: string
          habit_name: string
          id?: string
          is_active?: boolean | null
          target_value: number
          trainer_id: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          frequency?: string
          habit_id?: string
          habit_name?: string
          id?: string
          is_active?: boolean | null
          target_value?: number
          trainer_id?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      fitness_test_results: {
        Row: {
          assessment_id: string | null
          balance_notes: string | null
          cardio_test_result: string | null
          cardio_test_type: string | null
          client_id: string | null
          created_at: string | null
          estimated_vo2_max: number | null
          id: string
          movement_imbalances: string[] | null
          movement_notes: string | null
          other_tests: Json | null
          plank_hold_seconds: number | null
          posture_assessment: Json | null
          push_ups_count: number | null
          push_ups_type: string | null
          shoulder_flexibility_left: string | null
          shoulder_flexibility_right: string | null
          single_leg_stand_left_seconds: number | null
          single_leg_stand_right_seconds: number | null
          sit_and_reach_cm: number | null
          squat_assessment: string | null
          squat_notes: string | null
          squat_reps: number | null
          test_date: string | null
          trainer_observations: string | null
        }
        Insert: {
          assessment_id?: string | null
          balance_notes?: string | null
          cardio_test_result?: string | null
          cardio_test_type?: string | null
          client_id?: string | null
          created_at?: string | null
          estimated_vo2_max?: number | null
          id?: string
          movement_imbalances?: string[] | null
          movement_notes?: string | null
          other_tests?: Json | null
          plank_hold_seconds?: number | null
          posture_assessment?: Json | null
          push_ups_count?: number | null
          push_ups_type?: string | null
          shoulder_flexibility_left?: string | null
          shoulder_flexibility_right?: string | null
          single_leg_stand_left_seconds?: number | null
          single_leg_stand_right_seconds?: number | null
          sit_and_reach_cm?: number | null
          squat_assessment?: string | null
          squat_notes?: string | null
          squat_reps?: number | null
          test_date?: string | null
          trainer_observations?: string | null
        }
        Update: {
          assessment_id?: string | null
          balance_notes?: string | null
          cardio_test_result?: string | null
          cardio_test_type?: string | null
          client_id?: string | null
          created_at?: string | null
          estimated_vo2_max?: number | null
          id?: string
          movement_imbalances?: string[] | null
          movement_notes?: string | null
          other_tests?: Json | null
          plank_hold_seconds?: number | null
          posture_assessment?: Json | null
          push_ups_count?: number | null
          push_ups_type?: string | null
          shoulder_flexibility_left?: string | null
          shoulder_flexibility_right?: string | null
          single_leg_stand_left_seconds?: number | null
          single_leg_stand_right_seconds?: number | null
          sit_and_reach_cm?: number | null
          squat_assessment?: string | null
          squat_notes?: string | null
          squat_reps?: number | null
          test_date?: string | null
          trainer_observations?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fitness_test_results_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "fitness_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_responses: {
        Row: {
          completed: boolean | null
          created_at: string | null
          flow_token: string
          flow_type: string
          id: string
          phone_number: string
          processed: boolean | null
          response_data: Json
          screen_id: string | null
        }
        Insert: {
          completed?: boolean | null
          created_at?: string | null
          flow_token: string
          flow_type: string
          id?: string
          phone_number: string
          processed?: boolean | null
          response_data?: Json
          screen_id?: string | null
        }
        Update: {
          completed?: boolean | null
          created_at?: string | null
          flow_token?: string
          flow_type?: string
          id?: string
          phone_number?: string
          processed?: boolean | null
          response_data?: Json
          screen_id?: string | null
        }
        Relationships: []
      }
      flow_tokens: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data: Json | null
          expires_at: string | null
          flow_data: Json | null
          flow_token: string
          flow_type: string
          id: string
          phone_number: string | null
          status: string | null
          token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          flow_data?: Json | null
          flow_token: string
          flow_type: string
          id?: string
          phone_number?: string | null
          status?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          flow_data?: Json | null
          flow_token?: string
          flow_type?: string
          id?: string
          phone_number?: string | null
          status?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      gamification_points: {
        Row: {
          activity_data: Json | null
          activity_type: string
          client_id: string
          created_at: string | null
          id: string
          points: number
          reason: string
          trainer_id: string
        }
        Insert: {
          activity_data?: Json | null
          activity_type: string
          client_id: string
          created_at?: string | null
          id?: string
          points?: number
          reason: string
          trainer_id: string
        }
        Update: {
          activity_data?: Json | null
          activity_type?: string
          client_id?: string
          created_at?: string | null
          id?: string
          points?: number
          reason?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_points_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_points_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_profiles: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string
          is_public: boolean | null
          nickname: string | null
          notification_preferences: Json | null
          opted_in_global: boolean | null
          opted_in_trainer: boolean | null
          points_total: number | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          nickname?: string | null
          notification_preferences?: Json | null
          opted_in_global?: boolean | null
          opted_in_trainer?: boolean | null
          points_total?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          nickname?: string | null
          notification_preferences?: Json | null
          opted_in_global?: boolean | null
          opted_in_trainer?: boolean | null
          points_total?: number | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gamification_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_profiles_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: true
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_images: {
        Row: {
          alt_text: string
          created_at: string | null
          file_path: string | null
          filename: string
          id: string
          leonardo_image_id: string
          metadata: Json | null
          page_slug: string
          path: string
          placement: string
          prompt: string
          public_url: string
          updated_at: string | null
        }
        Insert: {
          alt_text: string
          created_at?: string | null
          file_path?: string | null
          filename: string
          id?: string
          leonardo_image_id: string
          metadata?: Json | null
          page_slug: string
          path: string
          placement: string
          prompt: string
          public_url: string
          updated_at?: string | null
        }
        Update: {
          alt_text?: string
          created_at?: string | null
          file_path?: string | null
          filename?: string
          id?: string
          leonardo_image_id?: string
          metadata?: Json | null
          page_slug?: string
          path?: string
          placement?: string
          prompt?: string
          public_url?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      generated_videos: {
        Row: {
          avatar_id: string | null
          completion_rate: number | null
          created_at: string | null
          duration: number | null
          error_message: string | null
          generation_prompt: string | null
          heygen_response: Json | null
          id: string
          post_id: string | null
          script_text: string | null
          status: string | null
          thumbnail_url: string | null
          updated_at: string | null
          video_id: string | null
          video_url: string | null
          view_count: number | null
          voice_id: string | null
        }
        Insert: {
          avatar_id?: string | null
          completion_rate?: number | null
          created_at?: string | null
          duration?: number | null
          error_message?: string | null
          generation_prompt?: string | null
          heygen_response?: Json | null
          id?: string
          post_id?: string | null
          script_text?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_id?: string | null
          video_url?: string | null
          view_count?: number | null
          voice_id?: string | null
        }
        Update: {
          avatar_id?: string | null
          completion_rate?: number | null
          created_at?: string | null
          duration?: number | null
          error_message?: string | null
          generation_prompt?: string | null
          heygen_response?: Json | null
          id?: string
          post_id?: string | null
          script_text?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_id?: string | null
          video_url?: string | null
          view_count?: number | null
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_videos_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
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
          status: string
        }
        Insert: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          error?: string | null
          id?: string
          image_id?: string | null
          job_id: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          error?: string | null
          id?: string
          image_id?: string | null
          job_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      group_classes: {
        Row: {
          class_date: string
          created_at: string | null
          currency: string | null
          current_participants: number | null
          description: string | null
          end_time: string | null
          id: string
          location: string | null
          max_participants: number | null
          price: number | null
          recurring_pattern: string | null
          start_time: string
          status: string | null
          title: string
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          class_date: string
          created_at?: string | null
          currency?: string | null
          current_participants?: number | null
          description?: string | null
          end_time?: string | null
          id?: string
          location?: string | null
          max_participants?: number | null
          price?: number | null
          recurring_pattern?: string | null
          start_time: string
          status?: string | null
          title: string
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          class_date?: string
          created_at?: string | null
          currency?: string | null
          current_participants?: number | null
          description?: string | null
          end_time?: string | null
          id?: string
          location?: string | null
          max_participants?: number | null
          price?: number | null
          recurring_pattern?: string | null
          start_time?: string
          status?: string | null
          title?: string
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      habit_challenges: {
        Row: {
          challenge_type: string
          created_at: string | null
          description: string | null
          duration_days: number
          end_date: string
          id: string
          is_active: boolean | null
          name: string
          participant_count: number | null
          reward: string | null
          start_date: string
          target_habit: string
          target_value: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          challenge_type: string
          created_at?: string | null
          description?: string | null
          duration_days: number
          end_date: string
          id?: string
          is_active?: boolean | null
          name: string
          participant_count?: number | null
          reward?: string | null
          start_date: string
          target_habit: string
          target_value?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          challenge_type?: string
          created_at?: string | null
          description?: string | null
          duration_days?: number
          end_date?: string
          id?: string
          is_active?: boolean | null
          name?: string
          participant_count?: number | null
          reward?: string | null
          start_date?: string
          target_habit?: string
          target_value?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_challenges_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_goals: {
        Row: {
          client_id: string
          created_at: string | null
          goal_type: string | null
          goal_value: string
          habit_type: string
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          goal_type?: string | null
          goal_value: string
          habit_type: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          goal_type?: string | null
          goal_value?: string
          habit_type?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          client_id: string
          completed_value: number
          created_at: string | null
          habit_id: string
          id: string
          log_date: string
          log_time: string | null
          notes: string | null
        }
        Insert: {
          client_id: string
          completed_value: number
          created_at?: string | null
          habit_id: string
          id?: string
          log_date: string
          log_time?: string | null
          notes?: string | null
        }
        Update: {
          client_id?: string
          completed_value?: number
          created_at?: string | null
          habit_id?: string
          id?: string
          log_date?: string
          log_time?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "fitness_habits"
            referencedColumns: ["habit_id"]
          },
        ]
      }
      habit_reminder_preferences: {
        Row: {
          client_id: string
          created_at: string | null
          id: string
          include_encouragement: boolean | null
          include_progress: boolean | null
          last_updated: string | null
          reminder_days: number[] | null
          reminder_enabled: boolean | null
          reminder_time: string | null
          timezone: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          id?: string
          include_encouragement?: boolean | null
          include_progress?: boolean | null
          last_updated?: string | null
          reminder_days?: number[] | null
          reminder_enabled?: boolean | null
          reminder_time?: string | null
          timezone?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          id?: string
          include_encouragement?: boolean | null
          include_progress?: boolean | null
          last_updated?: string | null
          reminder_days?: number[] | null
          reminder_enabled?: boolean | null
          reminder_time?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      habit_reminders: {
        Row: {
          client_id: string
          completed_habits: number
          created_at: string | null
          id: string
          message_sent: string | null
          remaining_habits: number
          reminder_date: string
          reminder_time: string
          reminder_type: string | null
          sent_at: string | null
          status: string | null
          total_habits: number
          updated_at: string | null
        }
        Insert: {
          client_id: string
          completed_habits?: number
          created_at?: string | null
          id?: string
          message_sent?: string | null
          remaining_habits?: number
          reminder_date: string
          reminder_time: string
          reminder_type?: string | null
          sent_at?: string | null
          status?: string | null
          total_habits?: number
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          completed_habits?: number
          created_at?: string | null
          id?: string
          message_sent?: string | null
          remaining_habits?: number
          reminder_date?: string
          reminder_time?: string
          reminder_type?: string | null
          sent_at?: string | null
          status?: string | null
          total_habits?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      habit_streaks: {
        Row: {
          client_id: string
          current_streak: number | null
          custom_habit_id: string | null
          grace_used_date: string | null
          habit_type: string
          id: string
          last_logged_date: string | null
          longest_streak: number | null
          streak_started_date: string | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          current_streak?: number | null
          custom_habit_id?: string | null
          grace_used_date?: string | null
          habit_type: string
          id?: string
          last_logged_date?: string | null
          longest_streak?: number | null
          streak_started_date?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          current_streak?: number | null
          custom_habit_id?: string | null
          grace_used_date?: string | null
          habit_type?: string
          id?: string
          last_logged_date?: string | null
          longest_streak?: number | null
          streak_started_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_streaks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habit_streaks_custom_habit_id_fkey"
            columns: ["custom_habit_id"]
            isOneToOne: false
            referencedRelation: "custom_habit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_templates: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          id: string
          is_active: boolean | null
          measurement_type: string | null
          name: string
          target_value: number | null
          trainer_id: string | null
          unit: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          measurement_type?: string | null
          name: string
          target_value?: number | null
          trainer_id?: string | null
          unit?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          measurement_type?: string | null
          name?: string
          target_value?: number | null
          trainer_id?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      habit_tracking: {
        Row: {
          assignment_id: string | null
          client_id: string
          completed: boolean | null
          created_at: string | null
          date: string
          habit_type: string
          id: string
          points_earned: number | null
          target_met: boolean | null
          target_value: number | null
          updated_at: string | null
          value: string
        }
        Insert: {
          assignment_id?: string | null
          client_id: string
          completed?: boolean | null
          created_at?: string | null
          date?: string
          habit_type: string
          id?: string
          points_earned?: number | null
          target_met?: boolean | null
          target_value?: number | null
          updated_at?: string | null
          value: string
        }
        Update: {
          assignment_id?: string | null
          client_id?: string
          completed?: boolean | null
          created_at?: string | null
          date?: string
          habit_type?: string
          id?: string
          points_earned?: number | null
          target_met?: boolean | null
          target_value?: number | null
          updated_at?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_tracking_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "client_habit_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habit_tracking_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          client_id: string | null
          created_at: string | null
          date: string
          habit_type: string
          id: string
          trainer_id: string
          updated_at: string | null
          value: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          date?: string
          habit_type: string
          id?: string
          trainer_id: string
          updated_at?: string | null
          value: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          date?: string
          habit_type?: string
          id?: string
          trainer_id?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          character_id: string | null
          created_at: string
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
      interaction_history: {
        Row: {
          first_interaction_at: string | null
          id: string
          interaction_count: number | null
          last_interaction_at: string | null
          phone_number: string
          user_type: string | null
        }
        Insert: {
          first_interaction_at?: string | null
          id?: string
          interaction_count?: number | null
          last_interaction_at?: string | null
          phone_number: string
          user_type?: string | null
        }
        Update: {
          first_interaction_at?: string | null
          id?: string
          interaction_count?: number | null
          last_interaction_at?: string | null
          phone_number?: string
          user_type?: string | null
        }
        Relationships: []
      }
      leaderboard_settings: {
        Row: {
          client_id: string
          created_at: string | null
          global_leaderboard_opted_in: boolean | null
          id: string
          nickname: string
          trainer_leaderboard_opted_in: boolean | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          global_leaderboard_opted_in?: boolean | null
          id?: string
          nickname: string
          trainer_leaderboard_opted_in?: boolean | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          global_leaderboard_opted_in?: boolean | null
          id?: string
          nickname?: string
          trainer_leaderboard_opted_in?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboards: {
        Row: {
          created_at: string | null
          id: string
          leaderboard_type: string
          period_end: string
          period_start: string
          rankings: Json
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          leaderboard_type: string
          period_end: string
          period_start: string
          rankings?: Json
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          leaderboard_type?: string
          period_end?: string
          period_start?: string
          rankings?: Json
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leaderboards_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      leonardo_reference_images: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_leonardo_upload: string | null
          last_used: string | null
          leonardo_image_id: string | null
          leonardo_upload_status: string | null
          name: string
          supabase_storage_url: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_leonardo_upload?: string | null
          last_used?: string | null
          leonardo_image_id?: string | null
          leonardo_upload_status?: string | null
          name: string
          supabase_storage_url: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_leonardo_upload?: string | null
          last_used?: string | null
          leonardo_image_id?: string | null
          leonardo_upload_status?: string | null
          name?: string
          supabase_storage_url?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      lora_dataset_images: {
        Row: {
          caption: string | null
          category: string
          created_at: string
          eval_details: Json | null
          eval_score: number | null
          eval_status: string
          human_approved: boolean | null
          id: string
          image_url: string
          lora_id: string
          prompt_template: string
          source: string
          storage_path: string
          variation_type: string
        }
        Insert: {
          caption?: string | null
          category?: string
          created_at?: string
          eval_details?: Json | null
          eval_score?: number | null
          eval_status?: string
          human_approved?: boolean | null
          id?: string
          image_url: string
          lora_id: string
          prompt_template: string
          source?: string
          storage_path: string
          variation_type: string
        }
        Update: {
          caption?: string | null
          category?: string
          created_at?: string
          eval_details?: Json | null
          eval_score?: number | null
          eval_status?: string
          human_approved?: boolean | null
          id?: string
          image_url?: string
          lora_id?: string
          prompt_template?: string
          source?: string
          storage_path?: string
          variation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lora_dataset_images_lora_id_fkey"
            columns: ["lora_id"]
            isOneToOne: false
            referencedRelation: "character_loras"
            referencedColumns: ["id"]
          },
        ]
      }
      message_history: {
        Row: {
          ai_intent: Json | null
          confidence: number | null
          created_at: string | null
          direction: string | null
          id: string
          intent: string | null
          message: string | null
          message_text: string | null
          message_type: string | null
          phone_number: string
          processed: boolean | null
          response_data: Json | null
          sender: string | null
        }
        Insert: {
          ai_intent?: Json | null
          confidence?: number | null
          created_at?: string | null
          direction?: string | null
          id?: string
          intent?: string | null
          message?: string | null
          message_text?: string | null
          message_type?: string | null
          phone_number: string
          processed?: boolean | null
          response_data?: Json | null
          sender?: string | null
        }
        Update: {
          ai_intent?: Json | null
          confidence?: number | null
          created_at?: string | null
          direction?: string | null
          id?: string
          intent?: string | null
          message?: string | null
          message_text?: string | null
          message_type?: string | null
          phone_number?: string
          processed?: boolean | null
          response_data?: Json | null
          sender?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          client_id: string | null
          content: string | null
          created_at: string | null
          direction: string
          id: string
          message_text: string
          message_type: string | null
          phone_number: string
          processed: boolean | null
          trainer_id: string | null
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          created_at?: string | null
          direction: string
          id?: string
          message_text: string
          message_type?: string | null
          phone_number: string
          processed?: boolean | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string
          id?: string
          message_text?: string
          message_type?: string | null
          phone_number?: string
          processed?: boolean | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_invoices: {
        Row: {
          client_id: string
          created_at: string | null
          currency: string | null
          due_date: string | null
          id: string
          last_reminder_at: string | null
          month_year: string
          paid_at: string | null
          payfast_payment_id: string | null
          payment_url: string | null
          reminder_sent_count: number | null
          status: string | null
          total_amount: number | null
          total_sessions: number | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          last_reminder_at?: string | null
          month_year: string
          paid_at?: string | null
          payfast_payment_id?: string | null
          payment_url?: string | null
          reminder_sent_count?: number | null
          status?: string | null
          total_amount?: number | null
          total_sessions?: number | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          last_reminder_at?: string | null
          month_year?: string
          paid_at?: string | null
          payfast_payment_id?: string | null
          payment_url?: string | null
          reminder_sent_count?: number | null
          status?: string | null
          total_amount?: number | null
          total_sessions?: number | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      nsw_lora_images: {
        Row: {
          ai_approved: boolean | null
          ai_rejection_reason: string | null
          angle_category: string | null
          anime_image_url: string | null
          anime_prompt: string | null
          caption: string | null
          clothing_state: string | null
          converted_image_url: string | null
          created_at: string
          human_approved: boolean | null
          id: string
          lighting_category: string | null
          pose_category: string | null
          prompt_index: number | null
          replicate_prediction_id: string | null
          session_id: string
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_approved?: boolean | null
          ai_rejection_reason?: string | null
          angle_category?: string | null
          anime_image_url?: string | null
          anime_prompt?: string | null
          caption?: string | null
          clothing_state?: string | null
          converted_image_url?: string | null
          created_at?: string
          human_approved?: boolean | null
          id?: string
          lighting_category?: string | null
          pose_category?: string | null
          prompt_index?: number | null
          replicate_prediction_id?: string | null
          session_id: string
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_approved?: boolean | null
          ai_rejection_reason?: string | null
          angle_category?: string | null
          anime_image_url?: string | null
          anime_prompt?: string | null
          caption?: string | null
          clothing_state?: string | null
          converted_image_url?: string | null
          created_at?: string
          human_approved?: boolean | null
          id?: string
          lighting_category?: string | null
          pose_category?: string | null
          prompt_index?: number | null
          replicate_prediction_id?: string | null
          session_id?: string
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nsw_lora_images_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "nsw_lora_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      nsw_lora_sessions: {
        Row: {
          created_at: string
          dataset_zip_url: string | null
          id: string
          lora_output_url: string | null
          name: string
          replicate_training_id: string | null
          replicate_training_url: string | null
          status: string
          target_approved_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          dataset_zip_url?: string | null
          id?: string
          lora_output_url?: string | null
          name: string
          replicate_training_id?: string | null
          replicate_training_url?: string | null
          status?: string
          target_approved_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          dataset_zip_url?: string | null
          id?: string
          lora_output_url?: string | null
          name?: string
          replicate_training_id?: string | null
          replicate_training_url?: string | null
          status?: string
          target_approved_count?: number
          updated_at?: string
        }
        Relationships: []
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
          payfast_token: string | null
          plan: string
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
          payfast_token?: string | null
          plan: string
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
          payfast_token?: string | null
          plan?: string
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
          auth_user_id: string | null
          both_channels_bonus: boolean
          created_at: string
          display_name: string | null
          email: string
          has_email: boolean
          has_whatsapp: boolean
          id: string
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          both_channels_bonus?: boolean
          created_at?: string
          display_name?: string | null
          email: string
          has_email?: boolean
          has_whatsapp?: boolean
          id?: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          both_channels_bonus?: boolean
          created_at?: string
          display_name?: string | null
          email?: string
          has_email?: boolean
          has_whatsapp?: boolean
          id?: string
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
      payfast_webhooks: {
        Row: {
          client_id: string | null
          created_at: string | null
          error_message: string | null
          event_type: string | null
          headers: Json | null
          id: string
          payfast_payment_id: string | null
          payfast_pf_payment_id: string | null
          payfast_token: string | null
          payload: Json | null
          payment_id: string | null
          processed: boolean | null
          processed_at: string | null
          signature: string | null
          signature_valid: boolean | null
          subscription_id: string | null
          trainer_id: string | null
          webhook_type: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          headers?: Json | null
          id?: string
          payfast_payment_id?: string | null
          payfast_pf_payment_id?: string | null
          payfast_token?: string | null
          payload?: Json | null
          payment_id?: string | null
          processed?: boolean | null
          processed_at?: string | null
          signature?: string | null
          signature_valid?: boolean | null
          subscription_id?: string | null
          trainer_id?: string | null
          webhook_type?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          headers?: Json | null
          id?: string
          payfast_payment_id?: string | null
          payfast_pf_payment_id?: string | null
          payfast_token?: string | null
          payload?: Json | null
          payment_id?: string | null
          processed?: boolean | null
          processed_at?: string | null
          signature?: string | null
          signature_valid?: boolean | null
          subscription_id?: string | null
          trainer_id?: string | null
          webhook_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payfast_webhooks_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_audit_log: {
        Row: {
          action: string
          action_by: string | null
          amount: number | null
          client_id: string | null
          created_at: string | null
          description: string | null
          id: string
          payment_id: string | null
          payment_request_id: string | null
          payout_id: string | null
          trainer_id: string | null
          whatsapp_message: string | null
          whatsapp_number: string | null
        }
        Insert: {
          action: string
          action_by?: string | null
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          payment_id?: string | null
          payment_request_id?: string | null
          payout_id?: string | null
          trainer_id?: string | null
          whatsapp_message?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          action?: string
          action_by?: string | null
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          payment_id?: string | null
          payment_request_id?: string | null
          payout_id?: string | null
          trainer_id?: string | null
          whatsapp_message?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_audit_log_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_audit_log_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_audit_log_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "trainer_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events_log: {
        Row: {
          created_at: string | null
          error_message: string | null
          event_type: string
          id: string
          payfast_payment_id: string | null
          payload: Json | null
          processed: boolean | null
          provider: string
          raw_data: Json | null
          status: string | null
          subscription_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          payfast_payment_id?: string | null
          payload?: Json | null
          processed?: boolean | null
          provider: string
          raw_data?: Json | null
          status?: string | null
          subscription_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          payfast_payment_id?: string | null
          payload?: Json | null
          processed?: boolean | null
          provider?: string
          raw_data?: Json | null
          status?: string | null
          subscription_id?: string | null
        }
        Relationships: []
      }
      payment_reminders: {
        Row: {
          clients_to_bill: number | null
          created_at: string | null
          id: string
          last_sent_date: string | null
          next_scheduled_date: string | null
          payment_requests_created: number | null
          reminder_day: number
          reminder_enabled: boolean | null
          reminder_sent_at: string | null
          total_clients: number | null
          trainer_id: string | null
          trainer_response: string | null
          updated_at: string | null
        }
        Insert: {
          clients_to_bill?: number | null
          created_at?: string | null
          id?: string
          last_sent_date?: string | null
          next_scheduled_date?: string | null
          payment_requests_created?: number | null
          reminder_day: number
          reminder_enabled?: boolean | null
          reminder_sent_at?: string | null
          total_clients?: number | null
          trainer_id?: string | null
          trainer_response?: string | null
          updated_at?: string | null
        }
        Update: {
          clients_to_bill?: number | null
          created_at?: string | null
          id?: string
          last_sent_date?: string | null
          next_scheduled_date?: string | null
          payment_requests_created?: number | null
          reminder_day?: number
          reminder_enabled?: boolean | null
          reminder_sent_at?: string | null
          total_clients?: number | null
          trainer_id?: string | null
          trainer_response?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          amount: number
          client_approved: boolean | null
          client_approved_at: string | null
          client_id: string | null
          client_whatsapp_response: string | null
          created_at: string | null
          description: string
          expires_at: string | null
          id: string
          payfast_payment_id: string | null
          payfast_payment_url: string | null
          payment_id: string | null
          payment_type: string | null
          period_end: string | null
          period_start: string | null
          sessions_covered: number | null
          status: string | null
          trainer_approved: boolean | null
          trainer_approved_at: string | null
          trainer_id: string | null
          trainer_whatsapp_response: string | null
        }
        Insert: {
          amount: number
          client_approved?: boolean | null
          client_approved_at?: string | null
          client_id?: string | null
          client_whatsapp_response?: string | null
          created_at?: string | null
          description: string
          expires_at?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_payment_url?: string | null
          payment_id?: string | null
          payment_type?: string | null
          period_end?: string | null
          period_start?: string | null
          sessions_covered?: number | null
          status?: string | null
          trainer_approved?: boolean | null
          trainer_approved_at?: string | null
          trainer_id?: string | null
          trainer_whatsapp_response?: string | null
        }
        Update: {
          amount?: number
          client_approved?: boolean | null
          client_approved_at?: string | null
          client_id?: string | null
          client_whatsapp_response?: string | null
          created_at?: string | null
          description?: string
          expires_at?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_payment_url?: string | null
          payment_id?: string | null
          payment_type?: string | null
          period_end?: string | null
          period_start?: string | null
          sessions_covered?: number | null
          status?: string | null
          trainer_approved?: boolean | null
          trainer_approved_at?: string | null
          trainer_id?: string | null
          trainer_whatsapp_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          auto_payment: boolean | null
          booking_id: string | null
          client_id: string | null
          created_at: string | null
          due_date: string | null
          id: string
          net_amount: number | null
          notes: string | null
          paid_date: string | null
          payfast_payment_id: string | null
          payfast_payment_status: string | null
          payfast_pf_payment_id: string | null
          payfast_signature: string | null
          payment_date: string | null
          payment_method: string | null
          payment_processor: string | null
          payment_reference: string | null
          payment_request_id: string | null
          payment_token_id: string | null
          payment_type: string | null
          platform_fee: number | null
          processor_fee: number | null
          status: string | null
          trainer_id: string | null
          webhook_data: Json | null
        }
        Insert: {
          amount: number
          auto_payment?: boolean | null
          booking_id?: string | null
          client_id?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          paid_date?: string | null
          payfast_payment_id?: string | null
          payfast_payment_status?: string | null
          payfast_pf_payment_id?: string | null
          payfast_signature?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_processor?: string | null
          payment_reference?: string | null
          payment_request_id?: string | null
          payment_token_id?: string | null
          payment_type?: string | null
          platform_fee?: number | null
          processor_fee?: number | null
          status?: string | null
          trainer_id?: string | null
          webhook_data?: Json | null
        }
        Update: {
          amount?: number
          auto_payment?: boolean | null
          booking_id?: string | null
          client_id?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          paid_date?: string | null
          payfast_payment_id?: string | null
          payfast_payment_status?: string | null
          payfast_pf_payment_id?: string | null
          payfast_signature?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_processor?: string | null
          payment_reference?: string | null
          payment_request_id?: string | null
          payment_token_id?: string | null
          payment_type?: string | null
          platform_fee?: number | null
          processor_fee?: number | null
          status?: string | null
          trainer_id?: string | null
          webhook_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_token_id_fkey"
            columns: ["payment_token_id"]
            isOneToOne: false
            referencedRelation: "client_payment_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_bookings: {
        Row: {
          booking_id: string | null
          client_id: string | null
          confirmed_at: string | null
          created_at: string | null
          expires_at: string
          id: string
          proposed_datetime: string
          proposed_duration: number | null
          status: string | null
          trainer_id: string | null
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          proposed_datetime: string
          proposed_duration?: number | null
          status?: string | null
          trainer_id?: string | null
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          proposed_datetime?: string
          proposed_duration?: number | null
          status?: string | null
          trainer_id?: string | null
        }
        Relationships: []
      }
      pending_workouts: {
        Row: {
          client_id: string
          client_name: string | null
          client_whatsapp: string | null
          created_at: string | null
          exercises: Json | null
          id: string
          trainer_id: string
          workout_message: string | null
        }
        Insert: {
          client_id: string
          client_name?: string | null
          client_whatsapp?: string | null
          created_at?: string | null
          exercises?: Json | null
          id?: string
          trainer_id: string
          workout_message?: string | null
        }
        Update: {
          client_id?: string
          client_name?: string | null
          client_whatsapp?: string | null
          created_at?: string | null
          exercises?: Json | null
          id?: string
          trainer_id?: string
          workout_message?: string | null
        }
        Relationships: []
      }
      performance_metrics: {
        Row: {
          cache_hit: boolean | null
          device_type: string | null
          id: string
          metric_name: string | null
          metric_type: string | null
          network_type: string | null
          timestamp: string | null
          trainer_id: string | null
          value_ms: number | null
        }
        Insert: {
          cache_hit?: boolean | null
          device_type?: string | null
          id?: string
          metric_name?: string | null
          metric_type?: string | null
          network_type?: string | null
          timestamp?: string | null
          trainer_id?: string | null
          value_ms?: number | null
        }
        Update: {
          cache_hit?: boolean | null
          device_type?: string | null
          id?: string
          metric_name?: string | null
          metric_type?: string | null
          network_type?: string | null
          timestamp?: string | null
          trainer_id?: string | null
          value_ms?: number | null
        }
        Relationships: []
      }
      photo_avatar_looks: {
        Row: {
          content_type: string
          created_at: string | null
          environment_description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          label: string
          lighting_description: string | null
          makeup_description: string | null
          outfit_description: string | null
          photo_avatar_id: string
          updated_at: string | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          environment_description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label: string
          lighting_description?: string | null
          makeup_description?: string | null
          outfit_description?: string | null
          photo_avatar_id: string
          updated_at?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          environment_description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label?: string
          lighting_description?: string | null
          makeup_description?: string | null
          outfit_description?: string | null
          photo_avatar_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      physical_measurements: {
        Row: {
          assessment_id: string | null
          blood_pressure_diastolic: number | null
          blood_pressure_systolic: number | null
          bmi: number | null
          body_fat_percentage: number | null
          calf_left: number | null
          calf_right: number | null
          chest: number | null
          client_id: string | null
          created_at: string | null
          forearm_left: number | null
          forearm_right: number | null
          height_cm: number | null
          hips: number | null
          id: string
          measurement_date: string | null
          muscle_mass_kg: number | null
          neck: number | null
          notes: string | null
          resting_heart_rate: number | null
          thigh_left: number | null
          thigh_right: number | null
          upper_arm_left: number | null
          upper_arm_right: number | null
          waist: number | null
          weight_kg: number | null
        }
        Insert: {
          assessment_id?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          bmi?: number | null
          body_fat_percentage?: number | null
          calf_left?: number | null
          calf_right?: number | null
          chest?: number | null
          client_id?: string | null
          created_at?: string | null
          forearm_left?: number | null
          forearm_right?: number | null
          height_cm?: number | null
          hips?: number | null
          id?: string
          measurement_date?: string | null
          muscle_mass_kg?: number | null
          neck?: number | null
          notes?: string | null
          resting_heart_rate?: number | null
          thigh_left?: number | null
          thigh_right?: number | null
          upper_arm_left?: number | null
          upper_arm_right?: number | null
          waist?: number | null
          weight_kg?: number | null
        }
        Update: {
          assessment_id?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          bmi?: number | null
          body_fat_percentage?: number | null
          calf_left?: number | null
          calf_right?: number | null
          chest?: number | null
          client_id?: string | null
          created_at?: string | null
          forearm_left?: number | null
          forearm_right?: number | null
          height_cm?: number | null
          hips?: number | null
          id?: string
          measurement_date?: string | null
          muscle_mass_kg?: number | null
          neck?: number | null
          notes?: string | null
          resting_heart_rate?: number | null
          thigh_left?: number | null
          thigh_right?: number | null
          upper_arm_left?: number | null
          upper_arm_right?: number | null
          waist?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_measurements_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "fitness_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      point_transactions: {
        Row: {
          client_id: string
          created_at: string | null
          description: string | null
          id: string
          points: number
          source: string
          source_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          points: number
          source: string
          source_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          points?: number
          source?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      posting_schedule: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          posting_times: string[]
          posts_per_day: number
          week_number: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          posting_times: string[]
          posts_per_day: number
          week_number: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          posting_times?: string[]
          posts_per_day?: number
          week_number?: number
        }
        Relationships: []
      }
      processed_messages: {
        Row: {
          created_at: string | null
          id: string
          message_text: string | null
          phone_number: string
          timestamp: string | null
          whatsapp_message_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_text?: string | null
          phone_number: string
          timestamp?: string | null
          whatsapp_message_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_text?: string | null
          phone_number?: string
          timestamp?: string | null
          whatsapp_message_id?: string
        }
        Relationships: []
      }
      question_library: {
        Row: {
          category: string
          created_at: string | null
          display_order: number | null
          field_name: string | null
          help_text: string | null
          id: string
          is_core: boolean | null
          options: Json | null
          question_text: string
          question_type: string | null
          subcategory: string | null
          validation_rules: Json | null
        }
        Insert: {
          category: string
          created_at?: string | null
          display_order?: number | null
          field_name?: string | null
          help_text?: string | null
          id?: string
          is_core?: boolean | null
          options?: Json | null
          question_text: string
          question_type?: string | null
          subcategory?: string | null
          validation_rules?: Json | null
        }
        Update: {
          category?: string
          created_at?: string | null
          display_order?: number | null
          field_name?: string | null
          help_text?: string | null
          id?: string
          is_core?: boolean | null
          options?: Json | null
          question_text?: string
          question_type?: string | null
          subcategory?: string | null
          validation_rules?: Json | null
        }
        Relationships: []
      }
      rate_limit_blocks: {
        Row: {
          blocked_at: string
          created_at: string | null
          id: string
          message_count: number | null
          phone_number: string
          reason: string | null
          unblock_at: string
        }
        Insert: {
          blocked_at: string
          created_at?: string | null
          id?: string
          message_count?: number | null
          phone_number: string
          reason?: string | null
          unblock_at: string
        }
        Update: {
          blocked_at?: string
          created_at?: string | null
          id?: string
          message_count?: number | null
          phone_number?: string
          reason?: string | null
          unblock_at?: string
        }
        Relationships: []
      }
      rate_limit_violations: {
        Row: {
          daily_count: number | null
          id: string
          ip_address: string | null
          message_type: string | null
          phone_number: string
          tokens_remaining: number | null
          violation_time: string | null
          violation_type: string | null
        }
        Insert: {
          daily_count?: number | null
          id?: string
          ip_address?: string | null
          message_type?: string | null
          phone_number: string
          tokens_remaining?: number | null
          violation_time?: string | null
          violation_type?: string | null
        }
        Update: {
          daily_count?: number | null
          id?: string
          ip_address?: string | null
          message_type?: string | null
          phone_number?: string
          tokens_remaining?: number | null
          violation_time?: string | null
          violation_type?: string | null
        }
        Relationships: []
      }
      recurring_bookings: {
        Row: {
          client_id: string
          created_at: string | null
          currency: string | null
          day_of_week: number
          end_date: string | null
          frequency: string | null
          id: string
          payment_method: string | null
          price_per_session: number | null
          session_time: string
          start_date: string
          status: string | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          currency?: string | null
          day_of_week: number
          end_date?: string | null
          frequency?: string | null
          id?: string
          payment_method?: string | null
          price_per_session?: number | null
          session_time: string
          start_date: string
          status?: string | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          currency?: string | null
          day_of_week?: number
          end_date?: string | null
          frequency?: string | null
          id?: string
          payment_method?: string | null
          price_per_session?: number | null
          session_time?: string
          start_date?: string
          status?: string | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      registration_analytics: {
        Row: {
          created_at: string | null
          error_field: string | null
          error_message: string | null
          event_type: string
          id: string
          phone_number: string
          step_number: number | null
          timestamp: string
          user_type: string | null
        }
        Insert: {
          created_at?: string | null
          error_field?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          phone_number: string
          step_number?: number | null
          timestamp: string
          user_type?: string | null
        }
        Update: {
          created_at?: string | null
          error_field?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          phone_number?: string
          step_number?: number | null
          timestamp?: string
          user_type?: string | null
        }
        Relationships: []
      }
      registration_attempts: {
        Row: {
          attempt_data: Json | null
          attempt_type: string | null
          created_at: string | null
          existing_user_id: string | null
          id: string
          ip_address: unknown
          phone: string
          user_agent: string | null
          user_type: string | null
        }
        Insert: {
          attempt_data?: Json | null
          attempt_type?: string | null
          created_at?: string | null
          existing_user_id?: string | null
          id?: string
          ip_address?: unknown
          phone: string
          user_agent?: string | null
          user_type?: string | null
        }
        Update: {
          attempt_data?: Json | null
          attempt_type?: string | null
          created_at?: string | null
          existing_user_id?: string | null
          id?: string
          ip_address?: unknown
          phone?: string
          user_agent?: string | null
          user_type?: string | null
        }
        Relationships: []
      }
      registration_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data: Json | null
          expires_at: string | null
          id: string
          last_error_at: string | null
          needs_retry: boolean | null
          phone: string
          registration_type: string
          retry_count: number | null
          status: string | null
          step: string
          updated_at: string | null
          user_type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          id?: string
          last_error_at?: string | null
          needs_retry?: boolean | null
          phone: string
          registration_type: string
          retry_count?: number | null
          status?: string | null
          step: string
          updated_at?: string | null
          user_type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          id?: string
          last_error_at?: string | null
          needs_retry?: boolean | null
          phone?: string
          registration_type?: string
          retry_count?: number | null
          status?: string | null
          step?: string
          updated_at?: string | null
          user_type?: string
        }
        Relationships: []
      }
      registration_state: {
        Row: {
          created_at: string | null
          data: Json | null
          expires_at: string | null
          id: string
          phone: string
          step: string
          updated_at: string | null
          user_type: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          id?: string
          phone: string
          step: string
          updated_at?: string | null
          user_type?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          expires_at?: string | null
          id?: string
          phone?: string
          step?: string
          updated_at?: string | null
          user_type?: string | null
        }
        Relationships: []
      }
      registration_states: {
        Row: {
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          current_step: number | null
          data: Json | null
          id: string
          phone_number: string
          updated_at: string | null
          user_type: string
        }
        Insert: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          data?: Json | null
          id?: string
          phone_number: string
          updated_at?: string | null
          user_type: string
        }
        Update: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          data?: Json | null
          id?: string
          phone_number?: string
          updated_at?: string | null
          user_type?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          created_at: string | null
          details: Json | null
          event_type: string | null
          id: string
          ip_address: string | null
          notes: string | null
          phone_number: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          event_type?: string | null
          id?: string
          ip_address?: string | null
          notes?: string | null
          phone_number?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          event_type?: string | null
          id?: string
          ip_address?: string | null
          notes?: string | null
          phone_number?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
        }
        Relationships: []
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
      social_analytics: {
        Row: {
          collected_at: string | null
          comments: number | null
          created_at: string | null
          engagement_rate: number | null
          id: string
          likes: number | null
          platform: string
          post_id: string | null
          reach: number | null
          shares: number | null
        }
        Insert: {
          collected_at?: string | null
          comments?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          id?: string
          likes?: number | null
          platform: string
          post_id?: string | null
          reach?: number | null
          shares?: number | null
        }
        Update: {
          collected_at?: string | null
          comments?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          id?: string
          likes?: number | null
          platform?: string
          post_id?: string | null
          reach?: number | null
          shares?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_analytics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_images: {
        Row: {
          created_at: string | null
          generation_prompt: string
          id: string
          image_type: string | null
          post_id: string | null
          replicate_url: string | null
          storage_path: string
          used_in_posts: string[] | null
        }
        Insert: {
          created_at?: string | null
          generation_prompt: string
          id?: string
          image_type?: string | null
          post_id?: string | null
          replicate_url?: string | null
          storage_path: string
          used_in_posts?: string[] | null
        }
        Update: {
          created_at?: string | null
          generation_prompt?: string
          id?: string
          image_type?: string | null
          post_id?: string | null
          replicate_url?: string | null
          storage_path?: string
          used_in_posts?: string[] | null
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          audio_track_id: string | null
          avg_watch_time: number | null
          caption_text: string | null
          carousel_image_urls: string[] | null
          completion_rate: number | null
          content_text: string
          content_theme: string | null
          created_at: string | null
          facebook_post_id: string | null
          generation_prompt: string | null
          has_captions: boolean | null
          hashtags: string | null
          id: string
          image_ids: string[] | null
          image_prompt: string | null
          image_url: string | null
          is_pinned: boolean | null
          media_generation_completed_at: string | null
          media_generation_started_at: string | null
          metadata: Json | null
          platform: string
          post_type: string
          processed_video_url: string | null
          published_time: string | null
          reel_title: string | null
          scheduled_time: string | null
          source_image_url: string | null
          status: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          video_duration: number | null
          video_id: string | null
          video_style: string | null
          video_type: string | null
          video_url: string | null
          week_number: number | null
        }
        Insert: {
          audio_track_id?: string | null
          avg_watch_time?: number | null
          caption_text?: string | null
          carousel_image_urls?: string[] | null
          completion_rate?: number | null
          content_text: string
          content_theme?: string | null
          created_at?: string | null
          facebook_post_id?: string | null
          generation_prompt?: string | null
          has_captions?: boolean | null
          hashtags?: string | null
          id?: string
          image_ids?: string[] | null
          image_prompt?: string | null
          image_url?: string | null
          is_pinned?: boolean | null
          media_generation_completed_at?: string | null
          media_generation_started_at?: string | null
          metadata?: Json | null
          platform: string
          post_type: string
          processed_video_url?: string | null
          published_time?: string | null
          reel_title?: string | null
          scheduled_time?: string | null
          source_image_url?: string | null
          status?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          video_duration?: number | null
          video_id?: string | null
          video_style?: string | null
          video_type?: string | null
          video_url?: string | null
          week_number?: number | null
        }
        Update: {
          audio_track_id?: string | null
          avg_watch_time?: number | null
          caption_text?: string | null
          carousel_image_urls?: string[] | null
          completion_rate?: number | null
          content_text?: string
          content_theme?: string | null
          created_at?: string | null
          facebook_post_id?: string | null
          generation_prompt?: string | null
          has_captions?: boolean | null
          hashtags?: string | null
          id?: string
          image_ids?: string[] | null
          image_prompt?: string | null
          image_url?: string | null
          is_pinned?: boolean | null
          media_generation_completed_at?: string | null
          media_generation_started_at?: string | null
          metadata?: Json | null
          platform?: string
          post_type?: string
          processed_video_url?: string | null
          published_time?: string | null
          reel_title?: string | null
          scheduled_time?: string | null
          source_image_url?: string | null
          status?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          video_duration?: number | null
          video_id?: string | null
          video_style?: string | null
          video_type?: string | null
          video_url?: string | null
          week_number?: number | null
        }
        Relationships: []
      }
      story_characters: {
        Row: {
          active_lora_id: string | null
          approved: boolean
          approved_fullbody: boolean
          approved_fullbody_image_id: string | null
          approved_fullbody_prompt: string | null
          approved_fullbody_seed: number | null
          approved_image_id: string | null
          approved_prompt: string | null
          approved_seed: number | null
          character_id: string
          face_url: string | null
          id: string
          lora_file_url: string | null
          lora_training_status: string | null
          lora_trigger_word: string | null
          prose_description: string | null
          regen_count: number
          role: string | null
          series_id: string
        }
        Insert: {
          active_lora_id?: string | null
          approved?: boolean
          approved_fullbody?: boolean
          approved_fullbody_image_id?: string | null
          approved_fullbody_prompt?: string | null
          approved_fullbody_seed?: number | null
          approved_image_id?: string | null
          approved_prompt?: string | null
          approved_seed?: number | null
          character_id: string
          face_url?: string | null
          id?: string
          lora_file_url?: string | null
          lora_training_status?: string | null
          lora_trigger_word?: string | null
          prose_description?: string | null
          regen_count?: number
          role?: string | null
          series_id: string
        }
        Update: {
          active_lora_id?: string | null
          approved?: boolean
          approved_fullbody?: boolean
          approved_fullbody_image_id?: string | null
          approved_fullbody_prompt?: string | null
          approved_fullbody_seed?: number | null
          approved_image_id?: string | null
          approved_prompt?: string | null
          approved_seed?: number | null
          character_id?: string
          face_url?: string | null
          id?: string
          lora_file_url?: string | null
          lora_training_status?: string | null
          lora_trigger_word?: string | null
          prose_description?: string | null
          regen_count?: number
          role?: string | null
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_characters_active_lora_id_fkey"
            columns: ["active_lora_id"]
            isOneToOne: false
            referencedRelation: "character_loras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_characters_approved_fullbody_image_id_fkey"
            columns: ["approved_fullbody_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_characters_approved_image_id_fkey"
            columns: ["approved_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
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
          character_id: string | null
          character_name: string | null
          created_at: string
          debug_data: Json | null
          id: string
          image_id: string | null
          image_type: string
          pairs_with: string | null
          position: number
          position_after_word: number | null
          post_id: string
          previous_image_id: string | null
          prompt: string
          secondary_character_id: string | null
          secondary_character_name: string | null
          sfw_image_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          character_id?: string | null
          character_name?: string | null
          created_at?: string
          debug_data?: Json | null
          id?: string
          image_id?: string | null
          image_type: string
          pairs_with?: string | null
          position?: number
          position_after_word?: number | null
          post_id: string
          previous_image_id?: string | null
          prompt: string
          secondary_character_id?: string | null
          secondary_character_name?: string | null
          sfw_image_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          character_id?: string | null
          character_name?: string | null
          created_at?: string
          debug_data?: Json | null
          id?: string
          image_id?: string | null
          image_type?: string
          pairs_with?: string | null
          position?: number
          position_after_word?: number | null
          post_id?: string
          previous_image_id?: string | null
          prompt?: string
          secondary_character_id?: string | null
          secondary_character_name?: string | null
          sfw_image_id?: string | null
          status?: string
          updated_at?: string
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
          created_at: string
          description: string | null
          hashtag: string | null
          id: string
          image_engine: string
          marketing: Json | null
          slug: string
          status: string
          title: string
          total_parts: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          hashtag?: string | null
          id?: string
          image_engine?: string
          marketing?: Json | null
          slug: string
          status?: string
          title: string
          total_parts?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          hashtag?: string | null
          id?: string
          image_engine?: string
          marketing?: Json | null
          slug?: string
          status?: string
          title?: string
          total_parts?: number
          updated_at?: string
        }
        Relationships: []
      }
      streak_milestones: {
        Row: {
          achieved_at: string | null
          badge_id: string | null
          client_id: string
          custom_habit_id: string | null
          habit_type: string
          id: string
          milestone_days: number
          points_awarded: number | null
        }
        Insert: {
          achieved_at?: string | null
          badge_id?: string | null
          client_id: string
          custom_habit_id?: string | null
          habit_type: string
          id?: string
          milestone_days: number
          points_awarded?: number | null
        }
        Update: {
          achieved_at?: string | null
          badge_id?: string | null
          client_id?: string
          custom_habit_id?: string | null
          habit_type?: string
          id?: string
          milestone_days?: number
          points_awarded?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "streak_milestones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streak_milestones_custom_habit_id_fkey"
            columns: ["custom_habit_id"]
            isOneToOne: false
            referencedRelation: "custom_habit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_notifications: {
        Row: {
          created_at: string | null
          delivered: boolean | null
          id: string
          message: string | null
          notification_type: string
          phone: string
          sent_at: string | null
          subscription_id: string | null
          trainer_id: string
        }
        Insert: {
          created_at?: string | null
          delivered?: boolean | null
          id?: string
          message?: string | null
          notification_type: string
          phone: string
          sent_at?: string | null
          subscription_id?: string | null
          trainer_id: string
        }
        Update: {
          created_at?: string | null
          delivered?: boolean | null
          id?: string
          message?: string | null
          notification_type?: string
          phone?: string
          sent_at?: string | null
          subscription_id?: string | null
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_notifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "trainer_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payment_history: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          id: string
          metadata: Json | null
          payment_date: string | null
          payment_method: string | null
          provider: string
          status: string
          subscription_id: string | null
          transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          id?: string
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          provider: string
          status: string
          subscription_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          id?: string
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          provider?: string
          status?: string
          subscription_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payment_history_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "trainer_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          max_clients: number
          paddle_product_id: string | null
          payfast_product_id: string | null
          plan_code: string
          plan_name: string
          price_annual: number | null
          price_monthly: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          max_clients: number
          paddle_product_id?: string | null
          payfast_product_id?: string | null
          plan_code: string
          plan_name: string
          price_annual?: number | null
          price_monthly?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          max_clients?: number
          paddle_product_id?: string | null
          payfast_product_id?: string | null
          plan_code?: string
          plan_name?: string
          price_annual?: number | null
          price_monthly?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      system_habits: {
        Row: {
          created_at: string | null
          default_target: number | null
          description: string | null
          emoji: string
          habit_type: string
          id: string
          measurement_type: string
          name: string
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          default_target?: number | null
          description?: string | null
          emoji: string
          habit_type: string
          id?: string
          measurement_type: string
          name: string
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          default_target?: number | null
          description?: string | null
          emoji?: string
          habit_type?: string
          id?: string
          measurement_type?: string
          name?: string
          unit?: string | null
        }
        Relationships: []
      }
      token_setup_requests: {
        Row: {
          client_id: string | null
          completed_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          reminder_sent: boolean | null
          sent_at: string | null
          setup_code: string | null
          setup_url: string | null
          status: string | null
          token_id: string | null
          trainer_id: string | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          reminder_sent?: boolean | null
          sent_at?: string | null
          setup_code?: string | null
          setup_url?: string | null
          status?: string | null
          token_id?: string | null
          trainer_id?: string | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          reminder_sent?: boolean | null
          sent_at?: string | null
          setup_code?: string | null
          setup_url?: string | null
          status?: string | null
          token_id?: string | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_setup_requests_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "client_payment_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      trainee_habit_assignments: {
        Row: {
          assigned_date: string | null
          client_id: string
          created_at: string | null
          habit_id: string
          id: string
          is_active: boolean | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          assigned_date?: string | null
          client_id: string
          created_at?: string | null
          habit_id: string
          id?: string
          is_active?: boolean | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          assigned_date?: string | null
          client_id?: string
          created_at?: string | null
          habit_id?: string
          id?: string
          is_active?: boolean | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trainee_habit_assignments_habit_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "fitness_habits"
            referencedColumns: ["habit_id"]
          },
        ]
      }
      trainer_bank_accounts: {
        Row: {
          account_holder_name: string
          account_number: string
          account_number_masked: string | null
          account_type: string | null
          bank_name: string
          branch_code: string
          created_at: string | null
          id: string
          is_verified: boolean | null
          trainer_id: string | null
          updated_at: string | null
          verification_amount: number | null
          verification_attempts: number | null
          verification_reference: string | null
          verified_at: string | null
        }
        Insert: {
          account_holder_name: string
          account_number: string
          account_number_masked?: string | null
          account_type?: string | null
          bank_name: string
          branch_code: string
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          trainer_id?: string | null
          updated_at?: string | null
          verification_amount?: number | null
          verification_attempts?: number | null
          verification_reference?: string | null
          verified_at?: string | null
        }
        Update: {
          account_holder_name?: string
          account_number?: string
          account_number_masked?: string | null
          account_type?: string | null
          bank_name?: string
          branch_code?: string
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          trainer_id?: string | null
          updated_at?: string | null
          verification_amount?: number | null
          verification_attempts?: number | null
          verification_reference?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      trainer_calendar_settings: {
        Row: {
          auto_confirm: boolean | null
          booking_window_days: number | null
          buffer_time: number | null
          cancellation_window_hours: number | null
          created_at: string | null
          currency: string | null
          daily_briefing_enabled: boolean | null
          daily_briefing_time: string | null
          default_price: number | null
          id: string
          min_notice_hours: number | null
          session_duration: number | null
          timezone: string | null
          trainer_id: string
          updated_at: string | null
          working_days: number[] | null
          working_hours_end: string | null
          working_hours_start: string | null
        }
        Insert: {
          auto_confirm?: boolean | null
          booking_window_days?: number | null
          buffer_time?: number | null
          cancellation_window_hours?: number | null
          created_at?: string | null
          currency?: string | null
          daily_briefing_enabled?: boolean | null
          daily_briefing_time?: string | null
          default_price?: number | null
          id?: string
          min_notice_hours?: number | null
          session_duration?: number | null
          timezone?: string | null
          trainer_id: string
          updated_at?: string | null
          working_days?: number[] | null
          working_hours_end?: string | null
          working_hours_start?: string | null
        }
        Update: {
          auto_confirm?: boolean | null
          booking_window_days?: number | null
          buffer_time?: number | null
          cancellation_window_hours?: number | null
          created_at?: string | null
          currency?: string | null
          daily_briefing_enabled?: boolean | null
          daily_briefing_time?: string | null
          default_price?: number | null
          id?: string
          min_notice_hours?: number | null
          session_duration?: number | null
          timezone?: string | null
          trainer_id?: string
          updated_at?: string | null
          working_days?: number[] | null
          working_hours_end?: string | null
          working_hours_start?: string | null
        }
        Relationships: []
      }
      trainer_client_list: {
        Row: {
          approved_at: string | null
          client_id: string
          connection_status: string | null
          created_at: string | null
          custom_price_per_session: number | null
          id: string
          invitation_token: string | null
          invited_at: string | null
          invited_by: string | null
          package_deal_active: boolean | null
          package_deal_details: Json | null
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          client_id: string
          connection_status?: string | null
          created_at?: string | null
          custom_price_per_session?: number | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          package_deal_active?: boolean | null
          package_deal_details?: Json | null
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          client_id?: string
          connection_status?: string | null
          created_at?: string | null
          custom_price_per_session?: number | null
          id?: string
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          package_deal_active?: boolean | null
          package_deal_details?: Json | null
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      trainer_exercise_defaults: {
        Row: {
          created_at: string | null
          default_reps: string
          default_rest_seconds: number
          default_sets: number
          default_weight_kg: number | null
          exercise_id: string
          id: string
          times_used: number
          trainer_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_reps: string
          default_rest_seconds: number
          default_sets: number
          default_weight_kg?: number | null
          exercise_id: string
          id?: string
          times_used?: number
          trainer_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_reps?: string
          default_rest_seconds?: number
          default_sets?: number
          default_weight_kg?: number | null
          exercise_id?: string
          id?: string
          times_used?: number
          trainer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trainer_exercise_defaults_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_exercise_defaults_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_payouts: {
        Row: {
          account_holder: string
          account_number_masked: string | null
          bank_name: string
          branch_code: string | null
          created_at: string | null
          id: string
          paid_at: string | null
          payment_ids: string[] | null
          payment_method: string | null
          payment_proof_url: string | null
          payment_reference: string | null
          payout_amount: number
          period_end: string
          period_start: string
          status: string | null
          total_collected: number | null
          total_payfast_fees: number | null
          total_platform_fees: number | null
          trainer_id: string | null
          transaction_count: number | null
        }
        Insert: {
          account_holder: string
          account_number_masked?: string | null
          bank_name: string
          branch_code?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_ids?: string[] | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payout_amount: number
          period_end: string
          period_start: string
          status?: string | null
          total_collected?: number | null
          total_payfast_fees?: number | null
          total_platform_fees?: number | null
          trainer_id?: string | null
          transaction_count?: number | null
        }
        Update: {
          account_holder?: string
          account_number_masked?: string | null
          bank_name?: string
          branch_code?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_ids?: string[] | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payout_amount?: number
          period_end?: string
          period_start?: string
          status?: string | null
          total_collected?: number | null
          total_payfast_fees?: number | null
          total_platform_fees?: number | null
          trainer_id?: string | null
          transaction_count?: number | null
        }
        Relationships: []
      }
      trainer_subscriptions: {
        Row: {
          auto_renew: boolean | null
          billing_amount: number | null
          billing_cycle: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          ended_at: string | null
          id: string
          last_notification_sent: string | null
          next_billing_date: string | null
          notification_type: string | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          payfast_data: Json | null
          payfast_payment_id: string | null
          payfast_profile_id: string | null
          payfast_subscription_id: string | null
          payfast_token: string | null
          payment_provider: string | null
          plan: string | null
          plan_id: string | null
          plan_type: string | null
          price: number | null
          status: string | null
          trainer_id: string
          trial_active: boolean | null
          trial_end_date: string | null
          trial_ends_at: string | null
          updated_at: string | null
          user_email: string | null
          user_phone: string | null
        }
        Insert: {
          auto_renew?: boolean | null
          billing_amount?: number | null
          billing_cycle?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: string
          last_notification_sent?: string | null
          next_billing_date?: string | null
          notification_type?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payfast_data?: Json | null
          payfast_payment_id?: string | null
          payfast_profile_id?: string | null
          payfast_subscription_id?: string | null
          payfast_token?: string | null
          payment_provider?: string | null
          plan?: string | null
          plan_id?: string | null
          plan_type?: string | null
          price?: number | null
          status?: string | null
          trainer_id: string
          trial_active?: boolean | null
          trial_end_date?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_email?: string | null
          user_phone?: string | null
        }
        Update: {
          auto_renew?: boolean | null
          billing_amount?: number | null
          billing_cycle?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: string
          last_notification_sent?: string | null
          next_billing_date?: string | null
          notification_type?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payfast_data?: Json | null
          payfast_payment_id?: string | null
          payfast_profile_id?: string | null
          payfast_subscription_id?: string | null
          payfast_token?: string | null
          payment_provider?: string | null
          plan?: string | null
          plan_id?: string | null
          plan_type?: string | null
          price?: number | null
          status?: string | null
          trainer_id?: string
          trial_active?: boolean | null
          trial_end_date?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_email?: string | null
          user_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trainer_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          started_at: string | null
          task_data: Json | null
          task_status: string | null
          task_type: string
          trainer_phone: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          started_at?: string | null
          task_data?: Json | null
          task_status?: string | null
          task_type: string
          trainer_phone: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          started_at?: string | null
          task_data?: Json | null
          task_status?: string | null
          task_type?: string
          trainer_phone?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      trainers: {
        Row: {
          additional_notes: string | null
          available_days: Json | null
          billing_currency: string | null
          birthdate: string | null
          business_name: string | null
          city: string | null
          country_code: string | null
          created_at: string | null
          default_price_per_session: number | null
          email: string
          experience_years: string | null
          first_name: string | null
          flow_token: string | null
          general_availability: string | null
          id: string
          last_name: string | null
          location: string | null
          marketing_consent: boolean | null
          name: string
          notification_preferences: Json | null
          onboarding_method: string | null
          payfast_configured: boolean | null
          payfast_configured_at: string | null
          payfast_merchant_id: string | null
          payfast_merchant_key: string | null
          payfast_passphrase: string | null
          payfast_test_mode: boolean | null
          preferred_time_slots: string | null
          pricing_flexibility: Json | null
          pricing_per_session: number | null
          registration_method: string | null
          services_offered: Json | null
          sex: string | null
          signup_source: string | null
          specialization: string | null
          specializations_arr: Json | null
          status: string | null
          subscription_end: string | null
          subscription_expires_at: string | null
          subscription_status: string | null
          terms_accepted: boolean | null
          terms_accepted_at: string | null
          trainer_id: string | null
          updated_at: string | null
          verification_code: string | null
          verification_sent_at: string | null
          verified_at: string | null
          whatsapp: string
          working_hours: Json | null
          years_experience: number | null
        }
        Insert: {
          additional_notes?: string | null
          available_days?: Json | null
          billing_currency?: string | null
          birthdate?: string | null
          business_name?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string | null
          default_price_per_session?: number | null
          email: string
          experience_years?: string | null
          first_name?: string | null
          flow_token?: string | null
          general_availability?: string | null
          id?: string
          last_name?: string | null
          location?: string | null
          marketing_consent?: boolean | null
          name: string
          notification_preferences?: Json | null
          onboarding_method?: string | null
          payfast_configured?: boolean | null
          payfast_configured_at?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          payfast_passphrase?: string | null
          payfast_test_mode?: boolean | null
          preferred_time_slots?: string | null
          pricing_flexibility?: Json | null
          pricing_per_session?: number | null
          registration_method?: string | null
          services_offered?: Json | null
          sex?: string | null
          signup_source?: string | null
          specialization?: string | null
          specializations_arr?: Json | null
          status?: string | null
          subscription_end?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          trainer_id?: string | null
          updated_at?: string | null
          verification_code?: string | null
          verification_sent_at?: string | null
          verified_at?: string | null
          whatsapp: string
          working_hours?: Json | null
          years_experience?: number | null
        }
        Update: {
          additional_notes?: string | null
          available_days?: Json | null
          billing_currency?: string | null
          birthdate?: string | null
          business_name?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string | null
          default_price_per_session?: number | null
          email?: string
          experience_years?: string | null
          first_name?: string | null
          flow_token?: string | null
          general_availability?: string | null
          id?: string
          last_name?: string | null
          location?: string | null
          marketing_consent?: boolean | null
          name?: string
          notification_preferences?: Json | null
          onboarding_method?: string | null
          payfast_configured?: boolean | null
          payfast_configured_at?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          payfast_passphrase?: string | null
          payfast_test_mode?: boolean | null
          preferred_time_slots?: string | null
          pricing_flexibility?: Json | null
          pricing_per_session?: number | null
          registration_method?: string | null
          services_offered?: Json | null
          sex?: string | null
          signup_source?: string | null
          specialization?: string | null
          specializations_arr?: Json | null
          status?: string | null
          subscription_end?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          trainer_id?: string | null
          updated_at?: string | null
          verification_code?: string | null
          verification_sent_at?: string | null
          verified_at?: string | null
          whatsapp?: string
          working_hours?: Json | null
          years_experience?: number | null
        }
        Relationships: []
      }
      trainers_archive: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          business_name: string | null
          created_at: string | null
          email: string | null
          id: string
          location: string | null
          merge_target_id: string | null
          name: string | null
          pricing_per_session: number | null
          specialization: string | null
          status: string | null
          subscription_expires_at: string | null
          subscription_status: string | null
          whatsapp: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          business_name?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          location?: string | null
          merge_target_id?: string | null
          name?: string | null
          pricing_per_session?: number | null
          specialization?: string | null
          status?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string | null
          whatsapp?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          business_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          location?: string | null
          merge_target_id?: string | null
          name?: string | null
          pricing_per_session?: number | null
          specialization?: string | null
          status?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      trending_audio: {
        Row: {
          audio_id: string | null
          audio_name: string
          audio_url: string | null
          best_performing_script: string | null
          content_created: boolean | null
          content_ideas: Json | null
          created_at: string | null
          discovered_at: string | null
          id: string
          last_used: string | null
          platform: string
          platform_usage_count: number | null
          trend_expires_at: string | null
          trend_score: number | null
          trend_velocity: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          audio_id?: string | null
          audio_name: string
          audio_url?: string | null
          best_performing_script?: string | null
          content_created?: boolean | null
          content_ideas?: Json | null
          created_at?: string | null
          discovered_at?: string | null
          id?: string
          last_used?: string | null
          platform: string
          platform_usage_count?: number | null
          trend_expires_at?: string | null
          trend_score?: number | null
          trend_velocity?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          audio_id?: string | null
          audio_name?: string
          audio_url?: string | null
          best_performing_script?: string | null
          content_created?: boolean | null
          content_ideas?: Json | null
          created_at?: string | null
          discovered_at?: string | null
          id?: string
          last_used?: string | null
          platform?: string
          platform_usage_count?: number | null
          trend_expires_at?: string | null
          trend_score?: number | null
          trend_velocity?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trending_audio_best_performing_script_fkey"
            columns: ["best_performing_script"]
            isOneToOne: false
            referencedRelation: "video_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string
          login_status: string | null
          phone_number: string
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          login_status?: string | null
          phone_number: string
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          login_status?: string | null
          phone_number?: string
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      verification_logs: {
        Row: {
          attempt_count: number | null
          created_at: string | null
          expires_at: string | null
          id: string
          ip_address: string | null
          phone: string
          user_agent: string | null
          verification_code: string
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          attempt_count?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          phone: string
          user_agent?: string | null
          verification_code: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          attempt_count?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          phone?: string
          user_agent?: string | null
          verification_code?: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: []
      }
      video_analytics: {
        Row: {
          analyzed_at: string | null
          click_through_rate: number | null
          comments_during_video: number | null
          completions: number | null
          conversion_rate: number | null
          created_at: string | null
          drop_off_second: number | null
          engagement_peak_second: number | null
          id: string
          post_id: string | null
          replays: number | null
          retention_curve: Json | null
          saves_from_video: number | null
          shares_from_video: number | null
          total_views: number | null
          trainer_id: string | null
          unique_viewers: number | null
          updated_at: string | null
          virality_coefficient: number | null
        }
        Insert: {
          analyzed_at?: string | null
          click_through_rate?: number | null
          comments_during_video?: number | null
          completions?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          drop_off_second?: number | null
          engagement_peak_second?: number | null
          id?: string
          post_id?: string | null
          replays?: number | null
          retention_curve?: Json | null
          saves_from_video?: number | null
          shares_from_video?: number | null
          total_views?: number | null
          trainer_id?: string | null
          unique_viewers?: number | null
          updated_at?: string | null
          virality_coefficient?: number | null
        }
        Update: {
          analyzed_at?: string | null
          click_through_rate?: number | null
          comments_during_video?: number | null
          completions?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          drop_off_second?: number | null
          engagement_peak_second?: number | null
          id?: string
          post_id?: string | null
          replays?: number | null
          retention_curve?: Json | null
          saves_from_video?: number | null
          shares_from_video?: number | null
          total_views?: number | null
          trainer_id?: string | null
          unique_viewers?: number | null
          updated_at?: string | null
          virality_coefficient?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_analytics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_analytics_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      video_generation_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          generated_thumbnail_url: string | null
          generated_video_url: string | null
          id: string
          priority: number | null
          processing_time: number | null
          retry_count: number | null
          scheduled_for: string | null
          script_id: string | null
          status: string | null
          task_type: string
          trainer_id: string | null
          trending_audio_id: string | null
          updated_at: string | null
          use_trending_audio: boolean | null
          video_duration: number | null
          video_style: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          generated_thumbnail_url?: string | null
          generated_video_url?: string | null
          id?: string
          priority?: number | null
          processing_time?: number | null
          retry_count?: number | null
          scheduled_for?: string | null
          script_id?: string | null
          status?: string | null
          task_type: string
          trainer_id?: string | null
          trending_audio_id?: string | null
          updated_at?: string | null
          use_trending_audio?: boolean | null
          video_duration?: number | null
          video_style?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          generated_thumbnail_url?: string | null
          generated_video_url?: string | null
          id?: string
          priority?: number | null
          processing_time?: number | null
          retry_count?: number | null
          scheduled_for?: string | null
          script_id?: string | null
          status?: string | null
          task_type?: string
          trainer_id?: string | null
          trending_audio_id?: string | null
          updated_at?: string | null
          use_trending_audio?: boolean | null
          video_duration?: number | null
          video_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_generation_queue_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "video_scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_generation_queue_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_generation_queue_trending_audio_id_fkey"
            columns: ["trending_audio_id"]
            isOneToOne: false
            referencedRelation: "trending_audio"
            referencedColumns: ["id"]
          },
        ]
      }
      video_generation_usage: {
        Row: {
          created_at: string
          credits_used: number | null
          duration_seconds: number | null
          id: string
          requested_at: string
          style: string | null
          success: boolean | null
          video_count: number | null
          video_id: string | null
        }
        Insert: {
          created_at?: string
          credits_used?: number | null
          duration_seconds?: number | null
          id?: string
          requested_at?: string
          style?: string | null
          success?: boolean | null
          video_count?: number | null
          video_id?: string | null
        }
        Update: {
          created_at?: string
          credits_used?: number | null
          duration_seconds?: number | null
          id?: string
          requested_at?: string
          style?: string | null
          success?: boolean | null
          video_count?: number | null
          video_id?: string | null
        }
        Relationships: []
      }
      video_scripts: {
        Row: {
          avg_completion_rate: number | null
          created_at: string | null
          duration_seconds: number
          emotion_tone: string | null
          hook_type: string | null
          id: string
          is_variant: boolean | null
          last_used_at: string | null
          performance_score: number | null
          script_structure: Json | null
          script_text: string
          total_views_generated: number | null
          trainer_id: string | null
          updated_at: string | null
          used_count: number | null
          variant_of: string | null
          variant_performance_diff: number | null
          video_style: string | null
          visual_cues: string | null
          word_count: number | null
        }
        Insert: {
          avg_completion_rate?: number | null
          created_at?: string | null
          duration_seconds: number
          emotion_tone?: string | null
          hook_type?: string | null
          id?: string
          is_variant?: boolean | null
          last_used_at?: string | null
          performance_score?: number | null
          script_structure?: Json | null
          script_text: string
          total_views_generated?: number | null
          trainer_id?: string | null
          updated_at?: string | null
          used_count?: number | null
          variant_of?: string | null
          variant_performance_diff?: number | null
          video_style?: string | null
          visual_cues?: string | null
          word_count?: number | null
        }
        Update: {
          avg_completion_rate?: number | null
          created_at?: string | null
          duration_seconds?: number
          emotion_tone?: string | null
          hook_type?: string | null
          id?: string
          is_variant?: boolean | null
          last_used_at?: string | null
          performance_score?: number | null
          script_structure?: Json | null
          script_text?: string
          total_views_generated?: number | null
          trainer_id?: string | null
          updated_at?: string | null
          used_count?: number | null
          variant_of?: string | null
          variant_performance_diff?: number | null
          video_style?: string | null
          visual_cues?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_scripts_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_scripts_variant_of_fkey"
            columns: ["variant_of"]
            isOneToOne: false
            referencedRelation: "video_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      video_templates: {
        Row: {
          aspect_ratio: string | null
          avg_completion_rate: number | null
          branding_position: string | null
          caption_style: string | null
          color_scheme: Json | null
          created_at: string | null
          description: string | null
          duration_range: string | null
          id: string
          is_active: boolean | null
          music_style: string | null
          scene_structure: Json
          template_name: string
          template_type: string
          times_used: number | null
          transition_style: string | null
          updated_at: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          avg_completion_rate?: number | null
          branding_position?: string | null
          caption_style?: string | null
          color_scheme?: Json | null
          created_at?: string | null
          description?: string | null
          duration_range?: string | null
          id?: string
          is_active?: boolean | null
          music_style?: string | null
          scene_structure: Json
          template_name: string
          template_type: string
          times_used?: number | null
          transition_style?: string | null
          updated_at?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          avg_completion_rate?: number | null
          branding_position?: string | null
          caption_style?: string | null
          color_scheme?: Json | null
          created_at?: string | null
          description?: string | null
          duration_range?: string | null
          id?: string
          is_active?: boolean | null
          music_style?: string | null
          scene_structure?: Json
          template_name?: string
          template_type?: string
          times_used?: number | null
          transition_style?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          created_at: string | null
          html_content: string | null
          id: string
          insights: Json | null
          metrics_json: Json
          sent_via_whatsapp: boolean | null
          updated_at: string | null
          week_end: string
          week_start: string
          whatsapp_message_id: string | null
          whatsapp_sent_at: string | null
          whatsapp_text: string | null
        }
        Insert: {
          created_at?: string | null
          html_content?: string | null
          id?: string
          insights?: Json | null
          metrics_json?: Json
          sent_via_whatsapp?: boolean | null
          updated_at?: string | null
          week_end: string
          week_start: string
          whatsapp_message_id?: string | null
          whatsapp_sent_at?: string | null
          whatsapp_text?: string | null
        }
        Update: {
          created_at?: string | null
          html_content?: string | null
          id?: string
          insights?: Json | null
          metrics_json?: Json
          sent_via_whatsapp?: boolean | null
          updated_at?: string | null
          week_end?: string
          week_start?: string
          whatsapp_message_id?: string | null
          whatsapp_sent_at?: string | null
          whatsapp_text?: string | null
        }
        Relationships: []
      }
      whatsapp_sessions: {
        Row: {
          context_json: Json | null
          created_at: string | null
          current_flow: string | null
          current_step: string | null
          id: string
          last_activity_at: string | null
          last_message: string | null
          phone_number: string
          updated_at: string | null
          user_id: string | null
          user_type: string
        }
        Insert: {
          context_json?: Json | null
          created_at?: string | null
          current_flow?: string | null
          current_step?: string | null
          id?: string
          last_activity_at?: string | null
          last_message?: string | null
          phone_number: string
          updated_at?: string | null
          user_id?: string | null
          user_type?: string
        }
        Update: {
          context_json?: Json | null
          created_at?: string | null
          current_flow?: string | null
          current_step?: string | null
          id?: string
          last_activity_at?: string | null
          last_message?: string | null
          phone_number?: string
          updated_at?: string | null
          user_id?: string | null
          user_type?: string
        }
        Relationships: []
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
      workout_exercises: {
        Row: {
          actual_weight_kg: number | null
          created_at: string | null
          exercise_id: string
          id: string
          is_bodyweight: boolean
          notes: string | null
          position: number
          reps: string
          rest_seconds: number
          sets: number
          target_weight_kg: number | null
          updated_at: string | null
          workout_id: string
        }
        Insert: {
          actual_weight_kg?: number | null
          created_at?: string | null
          exercise_id: string
          id?: string
          is_bodyweight?: boolean
          notes?: string | null
          position: number
          reps: string
          rest_seconds: number
          sets: number
          target_weight_kg?: number | null
          updated_at?: string | null
          workout_id: string
        }
        Update: {
          actual_weight_kg?: number | null
          created_at?: string | null
          exercise_id?: string
          id?: string
          is_bodyweight?: boolean
          notes?: string | null
          position?: number
          reps?: string
          rest_seconds?: number
          sets?: number
          target_weight_kg?: number | null
          updated_at?: string | null
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_history: {
        Row: {
          client_id: string | null
          completed: boolean | null
          exercises: Json
          feedback: string | null
          id: string
          sent_at: string | null
          trainer_id: string | null
          workout_name: string | null
        }
        Insert: {
          client_id?: string | null
          completed?: boolean | null
          exercises: Json
          feedback?: string | null
          id?: string
          sent_at?: string | null
          trainer_id?: string | null
          workout_name?: string | null
        }
        Update: {
          client_id?: string | null
          completed?: boolean | null
          exercises?: Json
          feedback?: string | null
          id?: string
          sent_at?: string | null
          trainer_id?: string | null
          workout_name?: string | null
        }
        Relationships: []
      }
      workout_templates: {
        Row: {
          created_at: string | null
          description: string | null
          exercises: Json
          id: string
          is_active: boolean | null
          template_name: string
          trainer_id: string | null
          updated_at: string | null
          workout_type: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          exercises: Json
          id?: string
          is_active?: boolean | null
          template_name: string
          trainer_id?: string | null
          updated_at?: string | null
          workout_type?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          exercises?: Json
          id?: string
          is_active?: boolean | null
          template_name?: string
          trainer_id?: string | null
          updated_at?: string | null
          workout_type?: string | null
        }
        Relationships: []
      }
      workouts: {
        Row: {
          client_id: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          difficulty_level: string | null
          duration_minutes: number | null
          exercises: Json | null
          id: string
          name: string
          trainer_id: string
          updated_at: string | null
          workout_type: string | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          difficulty_level?: string | null
          duration_minutes?: number | null
          exercises?: Json | null
          id?: string
          name: string
          trainer_id: string
          updated_at?: string | null
          workout_type?: string | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          difficulty_level?: string | null
          duration_minutes?: number | null
          exercises?: Json | null
          id?: string
          name?: string
          trainer_id?: string
          updated_at?: string | null
          workout_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workouts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
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
export type CharacterLoraRow =
  Database["public"]["Tables"]["character_loras"]["Row"];
export type CharacterLoraInsert =
  Database["public"]["Tables"]["character_loras"]["Insert"];
export type CharacterLoraUpdate =
  Database["public"]["Tables"]["character_loras"]["Update"];
export type LoraDatasetImageRow =
  Database["public"]["Tables"]["lora_dataset_images"]["Row"];
export type LoraDatasetImageInsert =
  Database["public"]["Tables"]["lora_dataset_images"]["Insert"];
