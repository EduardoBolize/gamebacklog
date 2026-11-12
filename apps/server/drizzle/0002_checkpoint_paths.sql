ALTER TABLE `checkpoints` ADD `leads_to` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `checkpoints` ADD `requirement` text;--> statement-breakpoint
ALTER TABLE `playthroughs` ADD `completed_checkpoint_ids` text DEFAULT '[]' NOT NULL;