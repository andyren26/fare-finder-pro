import { useEffect } from "react";

// Sets the document title and meta description for the current page.
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description !== undefined) {
      document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    }
  }, [title, description]);
}
