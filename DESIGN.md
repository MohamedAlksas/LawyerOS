# LawOffice OS — Interface design reference

Version: preliminary implementation design plan, 10 November 2026. These are proposed planning specifications; no interface has been implemented or visually tested against them yet.

## Experience direction

The interface is a daily working tool for an Egyptian lawyer working alone. Success means the project owner's father can identify his hearings, find the file, and record what happened without learning a complicated system. The usage mode is `Operate`: clarity, readability, and familiar controls take priority over display. A marketing page, courthouse photography, decorative scales of justice, entrance effects, or large statistics competing with today's hearings are not required.

The core concept is the office agenda and case file: the first screen starts with due work, and the matter file brings the information together. This borrows a familiar information order, rather than imitating paper through textures or decoration.

## Language and direction

- The application document uses `lang="ar-EG"` and `dir="rtl"` throughout. The interface uses clear, approachable Modern Standard Arabic without colloquial wording, with literal labels such as "تسجيل نتيجة الجلسة" (record hearing result), "حفظ" (save), "المطلوب قبل الجلسة" (required before the hearing), and "أموال الموكل المحتفظ بها للصرف" (client money held by us), with the financial term explained. Do not expose table names or database errors.
- Arabic names and text follow natural RTL flow. Phone numbers, email addresses, links, the file code `LO-2026-001`, and mixed numbers belong in `bdi`; a number/year group has explicit `ltr` direction. Do not reverse the text itself or add arbitrary spaces to repair direction.
- Use one consistent number format for display, accepting both `٠١٢٣٤٥٦٧٨٩` and `0123456789` on input. The currency label is "ج.م"; pound amounts have at most two decimal places, giving precision of one piastre. Court case and power-of-attorney numbers are reference text, not numeric values that lose leading zeros.
- All displayed dates follow `Africa/Cairo`, and a date without a time stays date-only. For example, display "الثلاثاء، 10 نوفمبر 2026" (Tuesday, 10 November 2026) instead of an ambiguous numeric date. An unknown optional hearing time displays "الساعة غير محددة" (time not specified); never insert 9 a.m. independently.
- Search filters use a normalized search copy of digits and some letter variants, while preserving the name exactly as entered. Never merge people automatically because their names resemble one another.

## Proposed visual system

All values below are proposals that may be adjusted after the first trial with the project owner's father; implement them as shared tokens.

| Element | Value / rule |
|---|---|
| Application font | Locally hosted `Noto Sans Arabic` with its license, falling back to `Tahoma, Arial, sans-serif` |
| Base text | `1rem`, line height `1.65`; input text no smaller than `1rem` |
| Sizes | `0.875rem` supporting text, `1rem` base, `1.125rem` group heading, `1.5rem` page heading; no essential text smaller than `0.875rem` |
| Page / content | `#F4F6F7` / `#FFFFFF` |
| Text / secondary text | `#172A35` / `#4D606A` |
| Dividers | `#D5DFE3`; input borders sufficiently darker to make the control clear |
| Primary | `#14566B`, with white text; for the primary action and current selection only |
| Success / warning / danger | `#176449` / `#7A4A00` / `#A4262C`, with text and an understandable icon |
| Focus indication | Visible `2px` ring with a `2px` gap, remaining distinct from backgrounds |
| Spacing | Steps of `4, 8, 12, 16, 24, 32px`; clear separation between form groups |
| Corners and shadow | `6px` corners, a light shadow for floating menus only; no unnecessary nested cards |
| Touch | Actual target area of at least `44×44px` for important buttons and selections |
| Motion | `150–200ms` for feedback only, respecting `prefers-reduced-motion` |

Measure contrast during implementation against WCAG AA; color names or visual inspection alone do not establish compliance. State must not rely on color alone. An unfamiliar icon has a text label, and a dangerous operation cannot rely on a tooltip for explanation.

## Page structure

**Desktop 1440px:** a right-hand navigation panel approximately `232px` wide, a top bar for search and quick actions, and content using the remaining space. Forms are grouped and may use two columns when their fields are independent. The case list uses a real table, and the detail view has a stable title and clear tabs. Do not put every client detail in the table.

**Tablet 768px:** navigation becomes a drawer, and forms use one or two columns depending on field width. Tables reduce their columns in favor of important information and a details action. Names, case numbers, and hearing details must not be truncated without a way to read the full text.

**Mobile 390px:** bottom navigation uses the literal labels "لوحة المتابعة، الملفات، البحث، المزيد" (dashboard, files, search, more). An "إضافة" (add) button opens clear creation options. Creation forms are full screens rather than a small dialog over another dialog. Lists become cards or rows showing the name, number, court, next hearing, and required action. Matter tabs become a section selector when space is limited, rather than disappearing offscreen. A sticky save button is allowed if it does not cover a field or its error message when the keyboard is open.

Quick actions use "نتيجة جلسة" (hearing result), "رفع مستند" (upload document), "تسجيل دفعة" (record payment), and "مهمة جديدة" (new task). They appear inside the matter with its details preselected, or from the home screen with matter selection first. Use one primary action per context, keeping delete/cancel away from save.

## States and interaction

- **Loading:** use a skeleton matching the content structure; do not show a zero balance or "لا توجد جلسات" (no hearings) before the request completes.
- **Empty:** show "لا توجد ملفات. أضف أول ملف للمكتب" (no files yet; add your first matter) with a clear action. Empty filtered results offer "تعديل عوامل التصفية" (change the filters), rather than encouraging accidental creation of new data.
- **Saving:** the button shows "جارٍ الحفظ" (saving) and prevents duplicate submission; final confirmation appears only after the server responds. A lost connection after submission shows "جارٍ التحقق من تسجيل العملية" (checking whether the operation was recorded) and queries with the same operation key. Pressing again must not create another hearing or receipt.
- **Error:** provide a summary above the form and a message beside each field, moving focus to the first error. Valid entries remain in page memory for the duration of the session. They are not automatically stored in `localStorage` or `IndexedDB`.
- **Disconnected:** a persistent banner says "انقطع الاتصال بالإنترنت. التعديلات غير محفوظة" (connection lost; changes are not saved). The MVP requires connectivity, and PWA means home-screen installation; do not promise synchronization, document access, or a confidential agenda without a connection. An open page may remain visible in memory until closed; this is not a supported offline mode.
- **Edit conflict:** show "عُدّلت البيانات من شاشة أخرى" (the data was changed from another screen), compare the newer version, and allow the edit to be reapplied. Do not silently overwrite the newer data.
- **Permission/session expiry:** show a clear login screen, then return to the requested page. Check a sensitive operation's status before resubmitting it. Locking the view clears sensitive data from the screen and requires reauthentication.
- **Archiving:** explain the effects and prevent hiding a future hearing or an open confirmed legal deadline; explicitly resolve the appointment first. Only receivables and noncritical tasks may continue with a reason and ongoing visibility in their reports. Posted financial operations offer "عكس العملية" (reverse operation) with a reason; there is no edit-value action for a posted entry.

## Accessibility and reading

Use semantic HTML and actual labels, Tab order matching reading order, visible focus, Escape to close the appropriate layer, and return focus to the control that opened it. The date picker allows typing and keyboard dismissal, and every day has a readable accessible name. A dialog traps focus without obstructing screen-reader use. Saving and error updates are announced to screen readers without excessive interruptions.

Test `200%` text zoom and `320px` as an additional reflow check: no loss of save actions or field readability. Horizontal scrolling is limited to tables that genuinely need it, inside a clearly identified region. PDF viewing permits an authorized download of the original when preview is unsupported.

## Verification required before interface acceptance

Review the implementation through screenshots and actual interaction at `390/768/1440px`, including empty, long-text, error, and network-failure states. Test keyboard use and text zoom, rather than relying on a desktop screenshot alone. Use Egyptian synthetic data labeled "بيانات تجريبية" (test data); never use actual client names or real national ID numbers in tests.

Initial trial targets with the project owner's father: identify the next hearing within 15 seconds, find a document within 30 seconds, and record a simple hearing result in roughly one minute after becoming familiar with the interface. These are product trial targets, not achieved measurements. If an operation requires continual explanation, revisit screen order and wording before adding features.
