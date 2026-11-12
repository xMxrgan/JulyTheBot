CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegramId" bigint NOT NULL UNIQUE,
	"username" varchar(32),
	"firstName" varchar(64) NOT NULL,
	"lastName" varchar(64),
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
