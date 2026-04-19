# Database Table Audit & Classification

**Date:** 2026-04-19
**Database:** Supabase project `mqemiteirxwscxtamdtj` (Refiloe Radebe)
**Schema:** public

## Summary

- **Total tables:** 148
- **NSW (No Safe Word):** 18 tables (12% — only 2 have data: `art_director_jobs` 41 rows, `images` 18 rows)
- **RR (Refiloe Radebe):** 119 tables (80% — only 2 have data: `booking_reminders` 51 rows, `bookings` 14 rows)
- **Shared:** 7 tables (all empty)
- **Unknown:** 4 tables (all empty)

The vast majority of tables belong to the Refiloe Radebe fitness trainer platform. Nearly all RR tables are completely empty (0 rows), making them strong archival candidates. The NSW tables are a small, well-scoped set. A handful of generic tables (analytics, sessions, dashboard tokens) could serve either project.

---

## NSW Tables

| Table | Rows | Notes |
|-------|------|-------|
| art_director_jobs | 41 | FK to images, series_id; intent_analysis, iterations, best_score |
| character_loras | 0 | FK to characters; trigger_word, training_params, pipeline_type, deployed_at |
| characters | 0 | name, description (jsonb) — base character identity |
| generation_evaluations | 0 | FK to images; composition_type, booru_tags, intent_score, failure_categories |
| generation_jobs | 0 | FK to images; job_id, cost — RunPod inference tracking |
| images | 18 | FK to characters; sfw_url, nsfw_url, prompt — core NSW image store |
| lora_dataset_images | 0 | FK to character_loras; eval_score, caption, category — LoRA training data |
| nsw_lora_images | 0 | FK to nsw_lora_sessions; anime_prompt, pose_category, clothing_state |
| nsw_lora_sessions | 0 | replicate_training_id, lora_output_url — Replicate-based LoRA training |
| nsw_payments | 0 | FK to nsw_users, nsw_subscriptions; payment_provider |
| nsw_purchases | 0 | FK to nsw_users, story_series; per-series purchases |
| nsw_subscriptions | 0 | FK to nsw_users; plan, payfast_token |
| nsw_users | 0 | auth_user_id, email, role, phone, has_whatsapp, both_channels_bonus |
| story_characters | 0 | FK to story_series, characters, character_loras, images; lora_trigger_word |
| story_image_prompts | 0 | FK to story_posts, images, characters; image_type, sfw_image_id, pairs_with |
| story_posts | 0 | FK to story_series; facebook_content, website_content, facebook_teaser |
| story_series | 0 | title, slug, image_engine — top-level series entity |
| whatsapp_pins | 0 | phone, pin, story_slug, chapter — WhatsApp story access auth |

## RR Tables (Archival Candidates)

### Core Entities (Trainers/Clients)

| Table | Rows | Notes |
|-------|------|-------|
| trainers | 0 | name, whatsapp, pricing_per_session, specializations, payfast config |
| trainers_archive | 0 | archived trainer records |
| clients | 0 | FK to trainers; whatsapp, sessions_remaining, package_type |
| clients_archive | 0 | archived client records |
| users | 0 | phone_number, trainer_id, client_id, login_status — RR auth bridge |

### Bookings & Calendar

| Table | Rows | Notes |
|-------|------|-------|
| bookings | 14 | FK to trainers, clients; session_datetime, payment_status |
| booking_payments | 0 | FK to bookings; payfast_payment_id |
| booking_reminders | 51 | FK to bookings; reminder_type, scheduled_at |
| booking_waitlist | 0 | FK to trainers, clients |
| calendar_events | 0 | FK to bookings; external_event_id |
| calendar_exceptions | 0 | trainer_id, exception_date |
| calendar_sync_preferences | 0 | trainer_id, google/outlook calendar |
| calendar_sync_status | 0 | trainer_id, provider, last_sync |
| cancellation_log | 0 | FK to bookings |
| group_classes | 0 | trainer_id, max_participants, price |
| pending_bookings | 0 | trainer_id, client_id, proposed_datetime |
| recurring_bookings | 0 | trainer_id, client_id, day_of_week |
| trainer_calendar_settings | 0 | working_hours, buffer_time, auto_confirm |

### Payments & Subscriptions

| Table | Rows | Notes |
|-------|------|-------|
| payments | 0 | FK to trainers, clients, payment_requests |
| payment_requests | 0 | trainer_id, client_id, payfast_payment_url |
| payment_reminders | 0 | trainer_id, reminder_day |
| payment_audit_log | 0 | FK to payments, payment_requests, trainer_payouts |
| payment_events_log | 0 | subscription_id, provider |
| payfast_webhooks | 0 | trainer_id, client_id, payfast_token |
| client_payment_consents | 0 | client_id, trainer_id |
| client_payment_preferences | 0 | client_id, auto_approve settings |
| client_payment_tokens | 0 | payfast_token, card details |
| token_setup_requests | 0 | client_id, setup_url |
| monthly_invoices | 0 | client_id, trainer_id, total_sessions |
| trainer_bank_accounts | 0 | trainer_id, bank details |
| trainer_payouts | 0 | trainer_id, payout_amount |
| trainer_subscriptions | 0 | trainer_id, payfast/paddle IDs |
| subscription_notifications | 0 | FK to trainer_subscriptions |
| subscription_payment_history | 0 | FK to trainer_subscriptions |
| subscription_plans | 0 | plan_name, max_clients, payfast/paddle IDs |
| country_pricing | 0 | country_name, starter/professional/studio tiers |

### Fitness & Assessments

| Table | Rows | Notes |
|-------|------|-------|
| exercises | 0 | muscle_group, gif_url_male/female, equipment |
| workouts | 0 | FK to trainers, clients |
| workout_exercises | 0 | FK to workouts, exercises |
| workout_templates | 0 | trainer_id, workout_type |
| workout_history | 0 | client_id, trainer_id |
| pending_workouts | 0 | trainer_id, client_id |
| fitness_assessments | 0 | client_id, trainer_id, medical history fields |
| fitness_goals | 0 | FK to fitness_assessments |
| fitness_test_results | 0 | FK to fitness_assessments; VO2 max, flexibility |
| physical_measurements | 0 | FK to fitness_assessments; body measurements |
| assessment_access_tokens | 0 | client_id |
| assessment_photos | 0 | FK to fitness_assessments |
| assessment_reminders | 0 | FK to assessment_templates |
| assessment_templates | 0 | trainer_id, include_health/measurements/photos |
| assessments | 0 | client_id, assessment_type |
| client_exercise_history | 0 | FK to trainers, clients, exercises |
| client_exercise_preferences | 0 | client_id, muscle_group |
| trainer_exercise_defaults | 0 | FK to trainers, exercises |
| question_library | 0 | category, question_text |

### Habits & Gamification

| Table | Rows | Notes |
|-------|------|-------|
| habits | 0 | FK to trainers, clients |
| habit_challenges | 0 | trainer_id, target_habit |
| habit_goals | 0 | client_id |
| habit_logs | 0 | FK to fitness_habits |
| habit_reminder_preferences | 0 | client_id |
| habit_reminders | 0 | client_id |
| habit_streaks | 0 | client_id |
| habit_templates | 0 | trainer_id |
| habit_tracking | 0 | client_id |
| fitness_habits | 0 | trainer_id, habit_name |
| client_habits | 0 | FK to habit_templates |
| client_habit_assignments | 0 | FK to trainers, clients |
| custom_habit_templates | 0 | trainer_id |
| system_habits | 0 | habit_type, measurement_type |
| trainee_habit_assignments | 0 | FK to fitness_habits |
| achievements | 0 | FK to clients, trainers; achievement_type |
| badge_definitions | 0 | FK to trainers; criteria_type |
| client_badges | 0 | FK to clients, badge_definitions |
| gamification_points | 0 | FK to clients, trainers |
| gamification_profiles | 0 | FK to clients, trainers |
| leaderboard_settings | 0 | client_id |
| leaderboards | 0 | trainer_id |
| point_transactions | 0 | client_id |
| streak_milestones | 0 | client_id |
| challenges | 0 | FK to trainers (created_by) |
| challenge_daily_progress | 0 | FK to challenge_participants |
| challenge_participants | 0 | FK to challenges, clients |
| challenge_progress | 0 | FK to challenges, challenge_participants |
| challenge_progress_log | 0 | FK to challenges, challenge_participants |

### Social Media & Video (RR Marketing)

| Table | Rows | Notes |
|-------|------|-------|
| social_posts | 0 | platform, facebook_post_id, video_url |
| social_analytics | 0 | FK to social_posts; likes, reach |
| social_images | 0 | replicate_url, post_id |
| posting_schedule | 0 | week_number, posts_per_day |
| generated_images | 0 | leonardo_image_id, page_slug — Leonardo AI (RR social) |
| generated_videos | 0 | FK to social_posts; heygen_response — HeyGen video gen |
| video_scripts | 0 | FK to trainers; hook_type, emotion_tone |
| video_templates | 0 | scene_structure, transition_style |
| video_analytics | 0 | FK to social_posts, trainers; retention_curve |
| video_generation_queue | 0 | FK to trainers, video_scripts |
| video_generation_usage | 0 | credits_used |
| trending_audio | 0 | FK to video_scripts; trend_score, platform |
| leonardo_reference_images | 0 | leonardo_image_id — Leonardo AI reference |
| avatar_looks | 0 | photo_avatar_id, look_type |
| photo_avatar_looks | 0 | photo_avatar_id, content_type |
| content_templates | 0 | template_name, template_type |
| content_types | 0 | name, settings |

### WhatsApp Bot & Messaging

| Table | Rows | Notes |
|-------|------|-------|
| conversation_states | 0 | phone_number, current_state, role_preference |
| message_history | 0 | phone_number, direction, ai_intent |
| messages | 0 | FK to trainers, clients |
| processed_messages | 0 | whatsapp_message_id |
| whatsapp_sessions | 0 | phone_number, user_type, current_flow |
| interaction_history | 0 | phone_number, user_type |
| client_invitations | 0 | trainer_id, client_phone |
| client_tasks | 0 | client_phone, task_type |
| trainer_tasks | 0 | trainer_phone, task_type |
| flow_responses | 0 | flow_token, phone_number |
| flow_tokens | 0 | phone_number, flow_type |

### Registration & Auth

| Table | Rows | Notes |
|-------|------|-------|
| registration_analytics | 0 | phone_number, user_type |
| registration_attempts | 0 | phone, user_type |
| registration_sessions | 0 | phone, user_type |
| registration_state | 0 | phone, user_type |
| registration_states | 0 | phone_number, user_type |
| verification_logs | 0 | phone, verification_code |
| rate_limit_blocks | 0 | phone_number |
| rate_limit_violations | 0 | phone_number |
| client_trainer_list | 0 | client_id, trainer_id |
| trainer_client_list | 0 | trainer_id, client_id |

### Dashboard & Analytics

| Table | Rows | Notes |
|-------|------|-------|
| dashboard_analytics | 0 | trainer_id, event_type, is_pwa |
| dashboard_links | 0 | trainer_id, short_code |
| dashboard_notifications | 0 | FK to trainers, clients |
| dashboard_stats | 0 | FK to trainers; total_clients, revenue_amount |
| dashboard_tokens_backup | 0 | FK to trainers — old token system |
| engagement_metrics | 0 | trainer_id, bounce_rate, installed_pwa |
| feature_usage | 0 | trainer_id, feature_name |
| performance_metrics | 0 | trainer_id, metric_type |
| weekly_reports | 0 | metrics_json, whatsapp_text |

### Data Management

| Table | Rows | Notes |
|-------|------|-------|
| data_deletion_requests | 0 | GDPR-style; user_type, email, phone |
| security_audit_log | 0 | phone_number, severity |
| activity_logs | 0 | user_type, activity_type, ip_address |

## Shared Tables

| Table | Rows | Notes |
|-------|------|-------|
| dashboard_tokens | 0 | Generic: user_id (text), role (text), purpose (text) — refactored from RR-specific version |
| page_views | 0 | page_path, referrer, device_type — could serve NSW website analytics |
| sessions | 0 | session_id, page_count, device_type — web session tracking |
| analytics_events | 0 | event_type, user_type, metadata — generic event tracking |

## Unknown Tables

| Table | Rows | Notes |
|-------|------|-------|
| generated_images | 0 | Has leonardo_image_id + page_slug + placement — likely RR social media (Leonardo AI era) but could also be generic |
| content_templates | 0 | template_name, template_type — generic enough for either project |
| content_types | 0 | name, description, settings — generic |

---

## Key Observations

1. **119 of 148 tables are RR-specific** and all but 2 (`bookings`: 6 rows, `booking_reminders`: 51 rows) are completely empty. These are strong archival/removal candidates.

2. **NSW is lean** — only 18 tables, well-prefixed (`nsw_*`, `story_*`, `character_*`, `*_lora*`). Only `art_director_jobs` (41) and `images` (18) have data.

3. **Total data across all 148 tables:** 124 rows. The database is almost entirely schema with no data.

4. **Duplicate/redundant RR tables exist:**
   - `registration_state` vs `registration_states` vs `registration_sessions` (3 tables for the same concept)
   - `client_trainer_list` vs `trainer_client_list` (bidirectional link tables)
   - `dashboard_tokens` vs `dashboard_tokens_backup`
   - `habits` vs `fitness_habits` vs `system_habits` vs `custom_habit_templates`

5. **Tables needing human review:**
   - `generated_images` — has Leonardo AI columns suggesting RR origin, but ambiguous
   - `page_views` / `sessions` / `analytics_events` — generic web analytics, unclear ownership
