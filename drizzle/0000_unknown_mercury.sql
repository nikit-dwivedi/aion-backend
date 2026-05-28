CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"cognitive_urgency" double precision DEFAULT 0 NOT NULL,
	"planning_relevance" double precision DEFAULT 0 NOT NULL,
	"requires_immediate_attention" boolean DEFAULT false NOT NULL,
	"estimated_cost" double precision DEFAULT 0 NOT NULL,
	"token_usage" integer DEFAULT 0 NOT NULL,
	"processing_weight" double precision DEFAULT 1 NOT NULL,
	"cognitive_complexity" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"reinforcement_count" integer DEFAULT 0 NOT NULL,
	"last_reinforced_at" timestamp,
	"retrieval_velocity" double precision DEFAULT 0 NOT NULL,
	"cognitive_momentum" double precision DEFAULT 0 NOT NULL,
	"attention_half_life" double precision DEFAULT 7 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"cognitive_importance" double precision DEFAULT 0 NOT NULL,
	"interruption_score" double precision DEFAULT 0 NOT NULL,
	"notification_fatigue" double precision DEFAULT 0 NOT NULL,
	"dismissal_velocity" double precision DEFAULT 0 NOT NULL,
	"cognitive_overload_score" double precision DEFAULT 0 NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"retrieved_node_id" uuid NOT NULL,
	"retrieval_reason" text,
	"feedback_state" text DEFAULT 'untracked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"llm_usage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"daily_inference_tokens" integer DEFAULT 0 NOT NULL,
	"monthly_inference_tokens" integer DEFAULT 0 NOT NULL,
	"embedding_usage" integer DEFAULT 0 NOT NULL,
	"research_requests" integer DEFAULT 0 NOT NULL,
	"planning_executions" integer DEFAULT 0 NOT NULL,
	"insight_generations" integer DEFAULT 0 NOT NULL,
	"retrieval_queries" integer DEFAULT 0 NOT NULL,
	"last_usage_reset_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_source_node_id_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_target_node_id_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_retrieved_node_id_nodes_id_fk" FOREIGN KEY ("retrieved_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;