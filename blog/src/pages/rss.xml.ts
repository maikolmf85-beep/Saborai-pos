import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  return rss({
    title: 'SaborAI Blog',
    description: 'Blog oficial de SaborAI POS — Recursos, guías y noticias para restaurantes en Costa Rica.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.slug}/`,
      author: post.data.author,
      categories: [post.data.category, ...post.data.tags],
    })),
    customData: `<language>es-CR</language>`,
  });
}
