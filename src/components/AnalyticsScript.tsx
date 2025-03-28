"use client";

import { useEffect } from "react";

export default function AnalyticsScript() {
  useEffect(() => {
    // クライアント側でdata-google-analytics-opt-out属性を設定
    document.documentElement.setAttribute("data-google-analytics-opt-out", "");
  }, []);

  return null;
}
