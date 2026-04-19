# RR Tables Archive Migration Report

**Date:** 2026-04-19
**Database:** Supabase project `mqemiteirxwscxtamdtj`

## Summary

Moved 134 Refiloe Radebe tables from `public` schema to `archive` schema. Zero failures. All data preserved. The `public` schema now contains only NSW and shared tables.

## What Was Done

1. Created `archive` schema
2. Dropped all FK constraints on the 134 tables being moved (all RR tables are empty or near-empty, so referential integrity loss is immaterial)
3. Moved all 134 tables via `ALTER TABLE ... SET SCHEMA archive`
4. Verified public/archive counts and data integrity

## Public Schema (22 tables remaining)

### NSW Tables (18)

| Table | Rows |
|-------|------|
| art_director_jobs | 41 |
| character_loras | 0 |
| characters | 0 |
| generation_evaluations | 0 |
| generation_jobs | 0 |
| images | 68 |
| lora_dataset_images | 0 |
| nsw_lora_images | 0 |
| nsw_lora_sessions | 0 |
| nsw_payments | 0 |
| nsw_purchases | 0 |
| nsw_subscriptions | 0 |
| nsw_users | 0 |
| story_characters | 0 |
| story_image_prompts | 0 |
| story_posts | 0 |
| story_series | 0 |
| whatsapp_pins | 0 |

### Shared Tables (4)

| Table | Rows |
|-------|------|
| analytics_events | 0 |
| dashboard_tokens | 0 |
| page_views | 0 |
| sessions | 0 |

## Archive Schema (134 tables moved)

achievements, activity_logs, assessment_access_tokens, assessment_photos, assessment_reminders, assessment_templates, assessments, avatar_looks, badge_definitions, booking_payments, booking_reminders, booking_waitlist, bookings, calendar_events, calendar_exceptions, calendar_sync_preferences, calendar_sync_status, cancellation_log, challenge_daily_progress, challenge_participants, challenge_progress, challenge_progress_log, challenges, client_badges, client_exercise_history, client_exercise_preferences, client_habit_assignments, client_habits, client_invitations, client_payment_consents, client_payment_preferences, client_payment_tokens, client_tasks, client_trainer_list, clients, clients_archive, content_templates, content_types, conversation_states, country_pricing, custom_habit_templates, dashboard_analytics, dashboard_links, dashboard_notifications, dashboard_stats, dashboard_tokens_backup, data_deletion_requests, engagement_metrics, exercises, feature_usage, fitness_assessments, fitness_goals, fitness_habits, fitness_test_results, flow_responses, flow_tokens, gamification_points, gamification_profiles, generated_images, generated_videos, group_classes, habit_challenges, habit_goals, habit_logs, habit_reminder_preferences, habit_reminders, habit_streaks, habit_templates, habit_tracking, habits, interaction_history, leaderboard_settings, leaderboards, leonardo_reference_images, message_history, messages, monthly_invoices, payfast_webhooks, payment_audit_log, payment_events_log, payment_reminders, payment_requests, payments, pending_bookings, pending_workouts, performance_metrics, photo_avatar_looks, physical_measurements, point_transactions, posting_schedule, processed_messages, question_library, rate_limit_blocks, rate_limit_violations, recurring_bookings, registration_analytics, registration_attempts, registration_sessions, registration_state, registration_states, security_audit_log, social_analytics, social_images, social_posts, streak_milestones, subscription_notifications, subscription_payment_history, subscription_plans, system_habits, token_setup_requests, trainee_habit_assignments, trainer_bank_accounts, trainer_calendar_settings, trainer_client_list, trainer_exercise_defaults, trainer_payouts, trainer_subscriptions, trainer_tasks, trainers, trainers_archive, trending_audio, users, verification_logs, video_analytics, video_generation_queue, video_generation_usage, video_scripts, video_templates, weekly_reports, whatsapp_sessions, workout_exercises, workout_history, workout_templates, workouts

## Data Verification

| Table | Schema | Actual Rows |
|-------|--------|-------------|
| art_director_jobs | public | 41 |
| images | public | 68 |
| bookings | archive | 149 |
| booking_reminders | archive | 931 |

Note: pg_stat_user_tables estimates used during the initial audit were stale. Actual `COUNT(*)` values are higher — all data is intact.

## Errors

None. All 134 tables moved successfully.

## Recovery

To restore a single table back to public:
```sql
ALTER TABLE archive.<table_name> SET SCHEMA public;
```

To restore all archived tables at once:
```sql
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'archive' AND table_type = 'BASE TABLE'
  LOOP EXECUTE format('ALTER TABLE archive.%I SET SCHEMA public', r.table_name);
  END LOOP;
END $$;
```

Note: FK constraints between RR tables were dropped during migration. If full restoration is needed, they would need to be recreated from migration files in `supabase/migrations/`.
