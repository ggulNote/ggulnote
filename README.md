# ggulnote

## ?„ë¡œ?íŠ¸ ?Œê°œ

ê¿€?¸íŠ¸???¬ìš©?ì˜ ?œì„ ?¼ë¡œ PDF/ë°±ì? ?¸ì§‘ ?ì—­??ì§€?•í•˜ê³? ?Œì„± ëª…ë ¹?¼ë¡œ ?„ê¸° ?„êµ¬ë¥??œì–´?˜ëŠ”
?¸ì¦ˆ?„ë¦¬ ë¬¸ì„œ ?¸ì§‘ ? í”Œë¦¬ì??´ì…˜?…ë‹ˆ??

ë³??¨ê³„??**Canvas Editor Core** êµ¬í˜„?…ë‹ˆ??

## ?„ì¬ ?¨ê³„

- 1?¨ê³„ ê¸°ë°˜ êµ¬ì„±(Next.js, Turborepo, ?ŒìŠ¤??CI) ê¸°ë°˜
- PDF ë°?ë°±ì? ë·°ì–´ ?•ìƒ ?™ì‘ ? ì?(ë¡œì»¬ ?´ê¸°, PDF.js ?Œë”ë§? ?˜ì´ì§€ ?´ë™/?•ë?ì¶•ì†Œ)
- Annotation Overlay ìº”ë²„??ì¶”ê? ë°??¸ì§‘ ì½”ì–´ ?™ì‘

## êµ¬í˜„ ë²”ìœ„

### êµ¬í˜„ ?„ë£Œ

- Annotation ê°ì²´ ëª¨ë¸
  - TEXT, UNDERLINE, HIGHLIGHT, SHAPE(rectangle/ellipse), LINE(line/arrow), TABLE
- ?˜ì´ì§€ë³?Scene ê´€ë¦?- Command ?¨í„´ ê¸°ë°˜ ?¸ì§‘ ?”ì§„
  - CREATE / UPDATE / DELETE / MOVE + Undo/Redo
- Canvas 2D Editor Renderer Adapter
- ?¬ì¸???¸í„°?™ì…˜
  - ? íƒ(?ˆíŠ¸ ?ŒìŠ¤??, ?´ë™(?œë˜ê·?ë¯¸ë¦¬ë³´ê¸° + ì»¤ë°‹/ì·¨ì†Œ), ?? œ
- ê°œë°œ???´ë°” ë°??”ë²„ê·??¨ë„ ?°ë™
- ë¬¸ì„œ/?˜ì´ì§€ ?„í™˜ ??Scene ë³´ì¡´
- ?•ê·œ??ì¢Œí‘œ ê¸°ì? ?Œë”ë§Â·íˆ?¸í…Œ?¤íŠ¸
- Annotation ì§ë ¬????§?¬í™”

### ?œì™¸(ë¯¸êµ¬??

- IndexedDB/?êµ¬ ?€??- Supabase ?°ë™
- ?ê²© ë¬¸ì„œ ?™ê¸°??- ?œì„ /ì¹´ë©”???Œì„±/LLM ?°ë™
- PDF??ì§ì ‘ Annotation ê·¸ë¦¬ê¸??€??- ???€ ?¸ì§‘, ?¬ê¸° ì¡°ì •, ?Œì „, ?ìœ ???¤ì?ì¹?
## ?µì‹¬ ?œì•½

- ?ˆë¡œê³ ì¹¨ ???ì„±??Annotation?€ ë©”ëª¨ë¦¬ì—?œë§Œ ? ì??˜ì–´ ?¬ë¼ì§‘ë‹ˆ??
- ìµœì¢… ?œë¹„?¤ì˜ ?Œì„±/?œì„  ?œì–´???¥í›„ ?¨ê³„?ì„œ ?€ì²´ë©?ˆë‹¤.

## ê¸°ìˆ  ?¤íƒ

- Next.js App Router (v16)
- React 19
- TypeScript strict
- Tailwind CSS
- Turborepo
- pnpm workspace
- ESLint
- Vitest + React Testing Library
- pdfjs-dist (ë¡œì»¬ worker)

## ?„ë¡œ?íŠ¸ êµ¬ì¡°

- `apps/web`: Next.js ? í”Œë¦¬ì??´ì…˜
  - `features/document`: PDF/ë°±ì? ë·°ì–´
  - `features/editor`: Annotation Canvas Overlay, Interaction, Core Adapter ?ˆì´??- `packages/editor-core`: Canvas Editor Core
  - Annotation ëª¨ë¸, Scene/?¤í† ?? Command, Engine, Renderer ?¸í„°?˜ì´?? ì§ë ¬??- `packages/shared-types`: ?•ê·œ??ì¢Œí‘œ/ID ê³µìš© ?€??
## ?¤ì¹˜

```bash
corepack enable
pnpm install
```

## ë¡œì»¬ ?¤í–‰

```bash
pnpm dev
```

?‘ì† URL:

```text
http://localhost:3000
http://localhost:3000/editor
http://localhost:3000/debug
```

## ?¤í–‰/ê²€ì¦?ëª…ë ¹

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## ë¬¸ì„œ

- `docs/architecture.md`: ???ë””???„í‚¤?ì²˜ ?„ì¬ êµ¬ì¡°
- `docs/canvas-editor.md`: Editor Core êµ¬í˜„ ?ì„¸

## ?¤ìŒ ê°œë°œ ?¨ê³„

- IndexedDB ë¡œì»¬ ?€??ë©”ëª¨ë¦??€ì²?
- ?´ì˜ ëª¨ë“ˆ ?°ë™(?œì„ /?Œì„±/LLM)

