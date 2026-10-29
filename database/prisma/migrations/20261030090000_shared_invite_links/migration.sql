-- Store the invite token encrypted so any authorized admin can copy the current link.
ALTER TABLE "Invite" ADD COLUMN "tokenCipher" TEXT;
