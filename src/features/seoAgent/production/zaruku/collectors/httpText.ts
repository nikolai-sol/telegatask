export type FetchTextResult = {
  status: number | null;
  finalUrl: string;
  text: string;
};

export type FetchText = (url: string) => Promise<FetchTextResult>;

export async function fetchText(url: string): Promise<FetchTextResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "telegatask-wgd/1.0 (+seo diagnostic)",
    },
  });
  return {
    status: response.status,
    finalUrl: response.url || url,
    text: await response.text(),
  };
}
