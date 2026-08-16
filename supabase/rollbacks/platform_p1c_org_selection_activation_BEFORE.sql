-- Revoke the separately approved P1C staff table activation before schema rollback.
-- Schema USAGE is intentionally preserved because it can predate P1C and is shared by legacy RPCs.

revoke select, insert, update, delete on
  climate_vote.assembly,
  climate_vote.session,
  climate_vote.discussion_topic,
  climate_vote.submission,
  climate_vote.ballot
from authenticated;

revoke select, insert, update, delete on climate_vote.membership from authenticated;
