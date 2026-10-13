-- Which contact wrote each customer message, so changing a ticket's contact
-- (or a colleague replying in copy) doesn't rewrite who said what. Null on
-- older messages, which read as the ticket's contact.
ALTER TABLE "messages" ADD COLUMN "author_contact_id" UUID;

ALTER TABLE "messages" ADD CONSTRAINT "messages_author_contact_id_fkey"
  FOREIGN KEY ("author_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_author_contact_id_idx" ON "messages"("author_contact_id");
