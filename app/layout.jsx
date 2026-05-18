import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../src/styles.css';

export const metadata = {
  title: 'Reel Orbit',
  description: 'Social automation command center for Instagram scraping, Pinterest publishing, and menswear engagement.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
