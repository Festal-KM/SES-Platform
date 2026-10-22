-- ============================================================================
-- チャットのリアクションに絵文字 12 種を足す（`chat_message_reactions.reaction` の CHECK を広げる）。
-- 2026-10-22、チャットレーン（担当: 紺野。「リアクションのスタンプとかもちゃんと入れて」→ 絵文字 12 種 + 既存の語 4 種に決定）。
-- ============================================================================
-- 🔴 判断事項 1: DB には絵文字そのものではなく英字の名前を入れる（`THUMBS_UP` など）
--    絵文字は端末・フォント・書き出し（CSV）で崩れることがある。画面が名前を絵文字に置き換える
--    （`apps/web/lib/chat/reactions.ts`）。読み上げ用の名前は `packages/i18n`。
-- 🔴 判断事項 2: 既存の 4 語（OK / THANKS / CHECKING / DONE）は残す（既存の行をそのまま有効にする）
-- 🔴 判断事項 3: 既存の行を書き換えない（制約を張り替えるだけ）—— FORCE RLS の解除は要らない
--    （HANDOFF §3 の「既存行を書き換える migration」には当たらない。CHECK の検証は RLS を通らない）。
-- 🔴 判断事項 4: UI_GUIDELINES §1「絵文字を使わない」の**例外**になる（チャットのリアクションだけ）。宮田の確認を PR で求める。
ALTER TABLE chat_message_reactions DROP CONSTRAINT IF EXISTS chat_message_reactions_reaction_check;
ALTER TABLE chat_message_reactions ADD CONSTRAINT chat_message_reactions_reaction_check CHECK (
  reaction IN (
    'OK', 'THANKS', 'CHECKING', 'DONE',
    'THUMBS_UP', 'PRAY', 'TADA', 'SMILE', 'JOY', 'EYES', 'BOW', 'SWEAT', 'CHECK', 'HEART', 'FIRE', 'CLAP'
  )
);
