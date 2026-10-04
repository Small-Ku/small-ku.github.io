declare module "hyphen/en/index.js" {
  const englishHyphenation: {
    hyphenateSync(text: string): string;
  };
  export default englishHyphenation;
}
