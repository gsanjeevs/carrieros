// app/loads/new/page.tsx
import Link from 'next/link'

export default function NewLoadPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">

      <div className="mb-8">
        <Link href="/loads" className="text-slate-400 text-sm hover:text-white flex items-center gap-1.5 mb-4 rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to Loads
        </Link>
        <h1 className="text-2xl font-semibold text-white">Add Load</h1>
        <p className="text-slate-400 text-sm mt-1">How do you want to enter this load?</p>
      </div>

      <div className="grid gap-4">

        {/* Paste rate con */}
        <Link
          href="/loads/new/paste"
          className="group flex items-start gap-4 p-5 bg-white/5 border border-white/8 hover:border-[#f97316]/40 hover:bg-[#f97316]/5 rounded-xl shadow-card-dark hover:shadow-hover-dark transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          <div className="w-10 h-10 rounded-lg bg-[#f97316]/15 flex items-center justify-center flex-shrink-0 group-hover:bg-[#f97316]/25 transition-colors">
            <span className="material-symbols-outlined text-[#f97316] text-[20px]">content_paste</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">Paste rate confirmation</p>
            <p className="text-slate-400 text-sm mt-0.5">Copy text from an email or document — we'll extract the details automatically</p>
          </div>
          <span className="material-symbols-outlined text-slate-600 group-hover:text-slate-400 text-[20px] mt-0.5 transition-colors">chevron_right</span>
        </Link>

        {/* Upload PDF — not built yet. Was a live Link to a route that
            doesn't exist (/loads/new/upload), a 404 waiting to happen mid-demo.
            Disabled and labeled honestly instead of silently building a PDF
            extraction feature that hasn't been scoped. */}
        <div
          aria-disabled="true"
          className="flex items-start gap-4 p-5 bg-white/5 border border-white/8 rounded-xl opacity-50 cursor-not-allowed shadow-card-dark"
        >
          <div className="w-10 h-10 rounded-lg bg-[#1abc9c]/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[#1abc9c] text-[20px]">upload_file</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">Upload PDF</p>
            <p className="text-slate-400 text-sm mt-0.5">Upload a rate con PDF — we'll read and extract the load details</p>
          </div>
          <span className="text-slate-500 text-xs font-medium">Coming soon</span>
        </div>

        {/* Manual entry — same issue, same fix (/loads/new/manual didn't exist). */}
        <div
          aria-disabled="true"
          className="flex items-start gap-4 p-5 bg-white/5 border border-white/8 rounded-xl opacity-50 cursor-not-allowed shadow-card-dark"
        >
          <div className="w-10 h-10 rounded-lg bg-white/8 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-slate-400 text-[20px]">edit</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">Enter manually</p>
            <p className="text-slate-400 text-sm mt-0.5">Type in the load details yourself</p>
          </div>
          <span className="text-slate-500 text-xs font-medium">Coming soon</span>
        </div>

      </div>
    </div>
  )
}
