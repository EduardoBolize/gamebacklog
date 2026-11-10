CREATE TABLE `game_external_ids` (
	`game_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text,
	`matched_by` text DEFAULT 'auto' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source`, `external_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_external_ids_game_idx` ON `game_external_ids` (`game_id`);--> statement-breakpoint
CREATE TABLE `game_times` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`origin` text NOT NULL,
	`main_minutes` integer,
	`main_extra_minutes` integer,
	`completionist_minutes` integer,
	`origin_url` text,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_times_game_origin_uq` ON `game_times` (`game_id`,`origin`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`alternative_titles` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`cover_url` text,
	`release_date` text,
	`release_year` integer,
	`platforms` text DEFAULT '[]' NOT NULL,
	`genres` text DEFAULT '[]' NOT NULL,
	`themes` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`franchise` text,
	`origin` text NOT NULL,
	`origin_url` text,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `games_title_idx` ON `games` (`title`);--> statement-breakpoint
CREATE INDEX `games_release_year_idx` ON `games` (`release_year`);--> statement-breakpoint
CREATE INDEX `games_franchise_idx` ON `games` (`franchise`);--> statement-breakpoint
CREATE TABLE `chapter_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`origin` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`prompt_version` text,
	`is_user_edited` integer DEFAULT false NOT NULL,
	`generated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_maps_game_uq` ON `chapter_maps` (`game_id`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_map_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`is_point_of_no_return` integer DEFAULT false NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_map_id`) REFERENCES `chapter_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkpoints_map_position_idx` ON `checkpoints` (`chapter_map_id`,`position`);--> statement-breakpoint
CREATE TABLE `library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`status` text NOT NULL,
	`platform` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_entries_game_uq` ON `library_entries` (`game_id`);--> statement-breakpoint
CREATE INDEX `library_entries_status_idx` ON `library_entries` (`status`);--> statement-breakpoint
CREATE TABLE `playthroughs` (
	`id` text PRIMARY KEY NOT NULL,
	`library_entry_id` text NOT NULL,
	`number` integer NOT NULL,
	`type` text DEFAULT 'normal' NOT NULL,
	`label` text,
	`goal` text DEFAULT 'finish' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`platform` text,
	`started_on` text,
	`finished_on` text,
	`playtime_minutes` integer,
	`current_checkpoint_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_entry_id`) REFERENCES `library_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playthroughs_entry_number_uq` ON `playthroughs` (`library_entry_id`,`number`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`library_entry_id` text NOT NULL,
	`playthrough_id` text,
	`score` real,
	`difficulty_score` real,
	`story_score` real,
	`gameplay_score` real,
	`level_design_score` real,
	`soundtrack_score` real,
	`visuals_score` real,
	`perceived_length_score` real,
	`body` text,
	`pros` text DEFAULT '[]' NOT NULL,
	`cons` text DEFAULT '[]' NOT NULL,
	`has_spoilers` integer DEFAULT false NOT NULL,
	`time_to_beat_minutes` integer,
	`reviewed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_entry_id`) REFERENCES `library_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reviews_score_ck" CHECK("reviews"."score" is null or ("reviews"."score" >= 0 and "reviews"."score" <= 10 and "reviews"."score" * 2 = round("reviews"."score" * 2))),
	CONSTRAINT "reviews_difficulty_score_ck" CHECK("reviews"."difficulty_score" is null or ("reviews"."difficulty_score" >= 0 and "reviews"."difficulty_score" <= 10 and "reviews"."difficulty_score" * 2 = round("reviews"."difficulty_score" * 2))),
	CONSTRAINT "reviews_story_score_ck" CHECK("reviews"."story_score" is null or ("reviews"."story_score" >= 0 and "reviews"."story_score" <= 10 and "reviews"."story_score" * 2 = round("reviews"."story_score" * 2))),
	CONSTRAINT "reviews_gameplay_score_ck" CHECK("reviews"."gameplay_score" is null or ("reviews"."gameplay_score" >= 0 and "reviews"."gameplay_score" <= 10 and "reviews"."gameplay_score" * 2 = round("reviews"."gameplay_score" * 2))),
	CONSTRAINT "reviews_level_design_score_ck" CHECK("reviews"."level_design_score" is null or ("reviews"."level_design_score" >= 0 and "reviews"."level_design_score" <= 10 and "reviews"."level_design_score" * 2 = round("reviews"."level_design_score" * 2))),
	CONSTRAINT "reviews_soundtrack_score_ck" CHECK("reviews"."soundtrack_score" is null or ("reviews"."soundtrack_score" >= 0 and "reviews"."soundtrack_score" <= 10 and "reviews"."soundtrack_score" * 2 = round("reviews"."soundtrack_score" * 2))),
	CONSTRAINT "reviews_visuals_score_ck" CHECK("reviews"."visuals_score" is null or ("reviews"."visuals_score" >= 0 and "reviews"."visuals_score" <= 10 and "reviews"."visuals_score" * 2 = round("reviews"."visuals_score" * 2))),
	CONSTRAINT "reviews_perceived_length_score_ck" CHECK("reviews"."perceived_length_score" is null or ("reviews"."perceived_length_score" >= 0 and "reviews"."perceived_length_score" <= 10 and "reviews"."perceived_length_score" * 2 = round("reviews"."perceived_length_score" * 2)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_playthrough_uq` ON `reviews` (`playthrough_id`) WHERE "reviews"."playthrough_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_entry_game_level_uq` ON `reviews` (`library_entry_id`) WHERE "reviews"."playthrough_id" is null;--> statement-breakpoint
CREATE INDEX `reviews_entry_idx` ON `reviews` (`library_entry_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`library_entry_id` text NOT NULL,
	`playthrough_id` text,
	`started_at` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`note` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_entry_id`) REFERENCES `library_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sessions_entry_started_idx` ON `sessions` (`library_entry_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_playthrough_idx` ON `sessions` (`playthrough_id`);--> statement-breakpoint
CREATE TABLE `collectible_progress` (
	`playthrough_id` text NOT NULL,
	`collectible_id` text NOT NULL,
	`is_collected` integer DEFAULT false NOT NULL,
	`collected_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`playthrough_id`, `collectible_id`),
	FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collectible_id`) REFERENCES `collectibles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collectible_progress_collectible_idx` ON `collectible_progress` (`collectible_id`);--> statement-breakpoint
CREATE TABLE `collectibles` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`checkpoint_id` text,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`is_missable` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`origin` text NOT NULL,
	`origin_url` text,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collectibles_game_idx` ON `collectibles` (`game_id`);--> statement-breakpoint
CREATE INDEX `collectibles_checkpoint_idx` ON `collectibles` (`checkpoint_id`);--> statement-breakpoint
CREATE TABLE `progress_events` (
	`id` text PRIMARY KEY NOT NULL,
	`playthrough_id` text NOT NULL,
	`raw_text` text,
	`checkpoint_id` text,
	`resolved_by` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `progress_events_playthrough_idx` ON `progress_events` (`playthrough_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `achievement_progress` (
	`playthrough_id` text NOT NULL,
	`achievement_id` text NOT NULL,
	`is_unlocked` integer DEFAULT false NOT NULL,
	`unlocked_at` integer,
	`origin` text DEFAULT 'manual' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`playthrough_id`, `achievement_id`),
	FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `achievement_progress_achievement_idx` ON `achievement_progress` (`achievement_id`);--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`origin` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`description` text,
	`icon_url` text,
	`global_percent` real,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_missable` integer DEFAULT false NOT NULL,
	`is_story` integer DEFAULT false NOT NULL,
	`is_ng_plus` integer DEFAULT false NOT NULL,
	`classified_by` text,
	`checkpoint_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`origin_url` text,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievements_game_origin_external_uq` ON `achievements` (`game_id`,`origin`,`external_id`);--> statement-breakpoint
CREATE INDEX `achievements_game_idx` ON `achievements` (`game_id`);--> statement-breakpoint
CREATE INDEX `achievements_checkpoint_idx` ON `achievements` (`checkpoint_id`);--> statement-breakpoint
CREATE TABLE `ai_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`feature` text NOT NULL,
	`game_id` text,
	`prompt_version` text NOT NULL,
	`provider_id` text,
	`model` text,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_cache_game_idx` ON `ai_cache` (`game_id`);--> statement-breakpoint
CREATE INDEX `ai_cache_expires_idx` ON `ai_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`feature` text NOT NULL,
	`provider_id` text,
	`model` text,
	`game_id` text,
	`input_tokens_estimated` integer DEFAULT 0 NOT NULL,
	`output_tokens_estimated` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cache_hit` integer DEFAULT false NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_log_created_idx` ON `ai_usage_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_log_game_idx` ON `ai_usage_log` (`game_id`);--> statement-breakpoint
CREATE TABLE `hints_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`game_id` text NOT NULL,
	`checkpoint_id` text,
	`kind` text NOT NULL,
	`level` integer NOT NULL,
	`stuck_on` text,
	`content` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`prompt_version` text NOT NULL,
	`provider_id` text,
	`model` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hints_cache_cache_key_unique` ON `hints_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `hints_cache_game_checkpoint_idx` ON `hints_cache` (`game_id`,`checkpoint_id`,`level`);--> statement-breakpoint
CREATE TABLE `source_cache` (
	`source` text NOT NULL,
	`cache_key` text NOT NULL,
	`url` text,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer,
	PRIMARY KEY(`source`, `cache_key`)
);
--> statement-breakpoint
CREATE INDEX `source_cache_expires_idx` ON `source_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `schema_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
