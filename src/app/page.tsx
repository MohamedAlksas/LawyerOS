export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-slate-900">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-6 text-center">
        <header className="space-y-2">
          <span className="inline-block px-3 py-1 text-xs font-semibold tracking-wider text-slate-700 bg-slate-100 rounded-full">
            المرحلة التأسيسية — M0 / T01
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            نظام إدارة مكتب المحاماة — LawOffice OS
          </h1>
          <p className="text-sm sm:text-base text-slate-600">
            واجهة أولية لمطابقة بيئة العمل والتوافق التقني
          </p>
        </header>

        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-right text-xs sm:text-sm text-amber-900 leading-relaxed space-y-2">
          <p className="font-semibold text-amber-950">
            ملاحظة تنظيمية:
          </p>
          <p>
            هذه الصفحة هي واجهة مبدئية محددة لإثبات جاهزية حزمة الأدوات (Next.js + React 19 + TypeScript Strict + Tailwind CSS).
          </p>
          <p>
            لا تتضمن هذه المرحلة أي سجلات وهمية أو وحدات عمل تطبيقية (مثل الموكلين، ملفات القضايا، الجلسات، أو الحسابات المالية)، حيث ستُبنى هذه الوحدات تباعاً في المهام القادمة وفقاً لخطة العمل المعتمدة.
          </p>
        </section>

        <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>الترميز: lang=ar-EG | dir=rtl</span>
          <span>الإصدار: 0.1.0 (T01 Foundation)</span>
        </footer>
      </div>
    </main>
  );
}
