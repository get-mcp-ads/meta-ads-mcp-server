/**
 * Ne jamais suivre une redirection, sur un runtime qui refuse de le dire ainsi.
 *
 * L'intention d'origine est une protection : suivre une redirection renverrait
 * l'en-tête d'autorisation vers l'hôte d'arrivée, et un jeton publicitaire
 * livré à un domaine choisi par un tiers est exactement ce qu'on ne veut pas.
 * Les clients l'exprimaient par `redirect: "error"`, ce que Node accepte.
 *
 * Les Workers ne l'acceptent pas. Leur `fetch` ne connaît que `follow` et
 * `manual`, et rejette la requête avant même de partir avec
 * « Invalid redirect value, must be one of "follow" or "manual" ». Le connecteur
 * TikTok était donc cassé de bout en bout en production : aucun appel
 * n'atteignait l'API, et le message d'erreur ne ressemblait à rien de connu.
 * Les mêmes lignes existaient chez Google Ads et Pinterest, sur les chemins qui
 * les traversaient.
 *
 * `manual` rend la réponse 3xx sans la suivre, et le refus devient explicite.
 * L'intention est intacte, elle est simplement vérifiée après coup plutôt que
 * déléguée à un runtime qui ne parle pas ce dialecte.
 */
export const NO_REDIRECT = "manual" as const;

/**
 * Rejette une redirection, avec assez de contexte pour être diagnostiquée.
 *
 * La destination est nommée : une redirection inattendue d'une API
 * publicitaire signale presque toujours autre chose, une authentification
 * expirée renvoyée vers une page de connexion, ou un point d'entrée déplacé.
 */
export function refuseRedirect(response: Response, api: string): void {
  if (response.status < 300 || response.status >= 400) return;
  const target = response.headers.get("location") ?? "an undisclosed location";
  throw new Error(
    `${api} answered ${response.status} redirecting to ${target}. Redirects are never followed, ` +
      `because the authorisation header would travel with them. This usually means the endpoint moved ` +
      `or the session expired.`,
  );
}
