/**
 * Filet de sécurité d'une page : si son code ne peut pas être chargé (réseau coupé, version remplacée) ou si elle
 * plante, un message remplace la page, la barre de navigation reste utilisable, et « Réessayer » recharge l'application.
 */
import { Component, type ReactNode } from 'react';
import { Button, EmptyState } from './kit';

export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState icon="🍷" title="Cette page n’a pas pu s’afficher" action={<Button onClick={() => location.reload()}>Réessayer</Button>}>
        Vérifiez la connexion internet, puis réessayez. Les autres pages restent accessibles.
      </EmptyState>
    );
  }
}
