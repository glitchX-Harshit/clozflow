"use client";

import Component from "@/components/ui/ai-loader";

export default function DemoOne() {
  return (
    <div className="flex min-h-[440px] w-full items-center justify-center bg-background p-10">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <p className="font-semibold text-foreground text-sm">Working</p>
        <div className="mt-6 space-y-7">
          <Component label="Thinking" showElapsed variant="dots" />
          <Component label="Reading the repository" showElapsed variant="bar" />
          <Component label="Running the test suite" variant="grid" />
        </div>
      </div>
    </div>
  );
}
