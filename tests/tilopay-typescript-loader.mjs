const apiSourceRoot = new URL('../api/', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !specifier.endsWith('.js') ||
      !context.parentURL?.startsWith(apiSourceRoot)
    ) {
      throw error;
    }

    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
}
