import { Inject, Injectable } from '@nestjs/common';
import type { PrintGateway } from '../../common/integration/print-gateway';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrintCardsService } from './print-cards.service';
import { printDisabled } from './print-errors';
import { PrintOrdersService } from './print-orders.service';
import { PrintPersonsService } from './print-persons.service';
import { PrintTemplatesService } from './print-templates.service';

/**
 * Implémentation du contrat `PRINT_GATEWAY` : la seule porte d'Ocall Print pour les autres applications.
 * Chaque méthode refuse le service quand Print est désactivé (aucun accès à sa base).
 */
@Injectable()
export class PrintGatewayService implements PrintGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly templates: PrintTemplatesService,
    private readonly cards: PrintCardsService,
    private readonly orders: PrintOrdersService,
    private readonly persons: PrintPersonsService,
  ) {}

  enabled(): boolean {
    return this.config.print.enabled;
  }

  private on() {
    if (!this.config.print.enabled) throw printDisabled();
  }

  listTemplates: PrintGateway['listTemplates'] = (a, s) => (this.on(), this.templates.list(a, s));
  createTemplate: PrintGateway['createTemplate'] = (a, t, i) => (
    this.on(),
    this.templates.create(a, t, i)
  );
  updateTemplate: PrintGateway['updateTemplate'] = (a, s, id, i) => (
    this.on(),
    this.templates.update(a, s, id, { name: i.name, layout: i.layout })
  );
  setTemplateLogo: PrintGateway['setTemplateLogo'] = (a, s, id, f) => (
    this.on(),
    this.templates.setLogo(a, s, id, f)
  );
  archiveTemplate: PrintGateway['archiveTemplate'] = (a, s, id) => (
    this.on(),
    this.templates.archive(a, s, id)
  );
  previewTemplate: PrintGateway['previewTemplate'] = (a, s, id, sample) => (
    this.on(),
    this.templates.preview(a, s, id, sample)
  );

  issueCards: PrintGateway['issueCards'] = (a, app, h) => (this.on(), this.cards.issue(a, app, h));
  listCards: PrintGateway['listCards'] = (a, s, f) => (this.on(), this.cards.list(a, s, f));
  revokeCard: PrintGateway['revokeCard'] = (a, s, id, r) => (
    this.on(),
    this.cards.revoke(a, s, id, r)
  );
  replaceCard: PrintGateway['replaceCard'] = (a, s, id, r) => (
    this.on(),
    this.cards.replace(a, s, id, r)
  );
  revokeHolderCards: PrintGateway['revokeHolderCards'] = (a, app, k, h, r) => (
    this.on(),
    this.cards.revokeHolder(a, app, k, h, r)
  );
  verifyCard: PrintGateway['verifyCard'] = (a, qr) => (this.on(), this.cards.verify(a, qr));
  cardPreview: PrintGateway['cardPreview'] = (a, s, id, t, c, p) => (
    this.on(),
    this.cards.preview(a, s, id, t, c, p)
  );

  submitOrder: PrintGateway['submitOrder'] = (a, t, i) => (this.on(), this.orders.submit(a, t, i));
  listOrders: PrintGateway['listOrders'] = (a, s, f) => (this.on(), this.orders.list(a, s, f));
  getOrder: PrintGateway['getOrder'] = (a, s, id) => (this.on(), this.orders.detail(a, s, id));
  cancelOrder: PrintGateway['cancelOrder'] = (a, s, id, r) => (
    this.on(),
    this.orders.cancel(a, s, id, r)
  );
  orderProofPdf: PrintGateway['orderProofPdf'] = (a, s, id) => (
    this.on(),
    this.orders.proofPdf(a, s, id)
  );

  transferablePersons: PrintGateway['transferablePersons'] = (a) => (
    this.on(),
    this.persons.transferable(a)
  );
  personPhoto: PrintGateway['personPhoto'] = (a, id) => (this.on(), this.persons.photo(a, id));
  completeTransfer: PrintGateway['completeTransfer'] = (a, id, t) => (
    this.on(),
    this.persons.completeTransfer(a, id, t)
  );
}
