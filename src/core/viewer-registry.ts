/**
 * `ViewerRegistry` — maps a `DocumentRef` to the `ViewerProvider` that can
 * handle it (design §3.5). Adding a backend = registering one provider.
 */

import type { Disposable, DocumentRef } from "./types";
import type { ViewerProvider } from "./viewer-provider";

export class ViewerRegistry {
  private readonly providers: ViewerProvider[] = [];

  /** Register a provider. Selection prefers earlier registrations on ties. */
  register(provider: ViewerProvider): Disposable {
    this.providers.push(provider);
    return {
      dispose: () => {
        const i = this.providers.indexOf(provider);
        if (i >= 0) this.providers.splice(i, 1);
      },
    };
  }

  /** The first registered provider that can handle the ref, or null. */
  providerFor(ref: DocumentRef): ViewerProvider | null {
    return this.providers.find((p) => p.canHandle(ref)) ?? null;
  }
}
