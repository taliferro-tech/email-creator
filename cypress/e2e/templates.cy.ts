import { API, USAGE } from '../support/helpers';

/**
 * Email templates (2026-11-05). The fixture is the backend's real render of
 * each template for a sample brand (Fernwood Coffee Co.), so the page is
 * checked against the true designs.
 */
interface Fixture {
  catalog: { templates: { id: string; starter: Record<string, string> }[]; brand: { name: string }; problems: unknown[] };
  renders: Record<string, { html: string }>;
}

/** Previews come back as the real design; a new alias catches only the renders after it's set. */
function stubRender ( alias = 'render' ): void {
  cy.fixture<Fixture>( 'templates.json' ).then( ( fx ) => {
    cy.intercept( 'POST', `${ API }/templates/render`, ( req ) => {
      const out = fx.renders[ req.body.templateId ] || fx.renders[ 'personal-note' ];
      req.reply( { success: true, text: '', subject: req.body.content?.[ 'email.subject' ] || 'Subject', preheader: '', warnings: [], removedSections: [], missing: [], bytes: 1, ...out } );
    } ).as( alias );
  } );
}

function stubTemplates ( catalog?: ( c: Fixture[ 'catalog' ] ) => Fixture[ 'catalog' ] ): void {
  cy.fixture<Fixture>( 'templates.json' ).then( ( fx ) => {
    cy.intercept( 'GET', `${ API }/templates`, catalog ? catalog( fx.catalog ) : fx.catalog ).as( 'templates' );
  } );
  stubRender();
}

function visitTemplates ( path = '/templates' ): void {
  cy.visit( path, {
    onBeforeLoad ( win ) {
      win.localStorage.setItem( 'email_creator_e2e_user', JSON.stringify( { uid: 'e2e-user', displayName: 'Ty Showers', email: 'ty@example.com' } ) );
    },
  } );
  cy.wait( '@templates' );
}

describe( 'Email templates', () => {
  it( 'offers Blank and the five designs in the person\'s brand, filtered by kind', () => {
    stubTemplates();
    visitTemplates();
    cy.get( '[data-cy=template-picker]' ).should( 'contain', 'Every template uses your brand: Fernwood Coffee Co.' );
    cy.get( '[data-cy=template-picker] .card' ).should( 'have.length', 6 );
    cy.get( '[data-cy=template-newsletter] iframe' ).should( 'exist' );
    cy.contains( '.filter', 'Personal' ).click();
    cy.get( '[data-cy=template-picker] .card' ).should( 'have.length', 1 ).and( 'contain', 'Personal note' );
    cy.contains( '.filter', 'All' ).click();
    cy.get( '[data-cy=template-blank]' ).click();
    cy.location( 'pathname' ).should( 'eq', '/' );
  } );

  it( 'edits a template: example words to start, sections switch off, the preview follows', () => {
    stubTemplates();
    visitTemplates();
    cy.get( '[data-cy=template-newsletter]' ).click();
    cy.location( 'pathname' ).should( 'eq', '/templates/newsletter' );
    cy.get( '[data-cy="field-email.subject"]' ).should( 'have.value', 'The Fernwood Monthly: winter roasts are here' );
    cy.get( '[data-cy=template-preview]' ).should( 'exist' );

    stubRender( 'switched' );
    cy.get( '[data-cy=toggle-story-3]' ).click();
    cy.wait( '@switched' ).its( 'request.body.hidden' ).should( 'deep.equal', [ 'story-3' ] );
    cy.get( '[data-cy=section-story-1]' ).click();
    stubRender( 'typed' );
    cy.get( '[data-cy="field-story1.title"]' ).clear().type( 'Our new espresso bar' );
    cy.wait( '@typed' ).its( 'request.body.content' ).should( 'have.property', 'story1.title', 'Our new espresso bar' );
  } );

  it( 'writes the words for the business and marks what only the person knows', () => {
    stubTemplates();
    visitTemplates( '/templates/promotion' );
    cy.intercept( 'POST', `${ API }/templates/write`, {
      success: true,
      content: { 'email.subject': 'Holiday sale at Fernwood', 'offer.subhead': 'On every bag of beans' },
      needs: [ 'offer.code' ],
      reply: 'Written for your holiday sale.',
      usage: { ...USAGE, used: 2, remaining: 8 },
    } ).as( 'write' );
    cy.get( '[data-cy=template-ask]' ).type( 'A holiday sale for newsletter readers' );
    cy.get( '[data-cy=template-write]' ).click();
    cy.wait( '@write' ).its( 'request.body' ).should( 'include', { templateId: 'promotion', ask: 'A holiday sale for newsletter readers' } );
    cy.get( '[data-cy="field-email.subject"]' ).should( 'have.value', 'Holiday sale at Fernwood' );
    cy.get( '[data-cy=writer-note]' ).should( 'contain', 'Still yours to fill in' );
    cy.get( '[data-cy=section-code]' ).click();
    cy.get( '[data-cy="field-offer.code"]' ).should( 'have.value', '' ).and( 'have.class', 'needed' );
  } );

  it( 'saves to Docs and reopens from the saved copy', () => {
    stubTemplates();
    visitTemplates( '/templates/personal-note' );
    cy.intercept( 'POST', `${ API }/templates/save`, { success: true, documentId: 'doc-1', title: 'Thanks for coming by' } ).as( 'save' );
    cy.get( '[data-cy=template-save]' ).click();
    cy.wait( '@save' ).its( 'request.body' ).should( 'include', { templateId: 'personal-note', documentId: '' } );
    cy.get( '[data-cy=template-notice]' ).should( 'contain', 'Saved to Docs' );
    cy.location( 'search' ).should( 'eq', '?doc=doc-1' );
    cy.get( '[data-cy=template-save]' ).should( 'contain', 'Save' ).click();
    cy.wait( '@save' ).its( 'request.body.documentId' ).should( 'eq', 'doc-1' );

    cy.intercept( 'GET', `${ API }/templates/saved/doc-2`, { success: true, documentId: 'doc-2', title: 'Old', templateId: 'event', content: { 'email.subject': 'Saved subject' }, hidden: [ 'agenda' ] } ).as( 'saved' );
    visitTemplates( '/templates/newsletter?doc=doc-2' );
    cy.wait( '@saved' );
    cy.location( 'pathname' ).should( 'eq', '/templates/event' );
    cy.get( '[data-cy="field-email.subject"]' ).should( 'have.value', 'Saved subject' );
    cy.get( '[data-cy=toggle-agenda]' ).should( 'have.attr', 'aria-checked', 'false' );
  } );

  it( 'hands the finished email to Outreach', () => {
    stubTemplates();
    visitTemplates( '/templates/announcement' );
    cy.intercept( 'POST', `${ API }/handoff/check`, { success: true, canSendWithOutreach: true, fillIns: { catalyst: [], composer: [], drips: [] } } ).as( 'check' );
    cy.intercept( 'POST', `${ API }/handoff`, { success: true, id: 'h1', url: 'https://outreach.16ahead.com/email-processor?handoff=h1' } ).as( 'handoff' );
    cy.get( '[data-cy=template-next]' ).click();
    cy.get( '[data-cy=target-catalyst]' ).click();
    cy.wait( '@check' );
    cy.get( '[data-cy=template-handoff]' ).click();
    cy.wait( '@handoff' ).its( 'request.body.target' ).should( 'eq', 'catalyst' );
    cy.get( '[data-cy=template-open-outreach]' ).should( 'have.attr', 'href', 'https://outreach.16ahead.com/email-processor?handoff=h1' );
  } );

  it( 'sends to the Store customers who asked for emails, and only the rest the second time', () => {
    cy.intercept( 'GET', `${ API }/templates/customers`, { success: true, count: 3, stores: [ 'Fernwood Coffee' ], canSend: true } ).as( 'customers' );
    stubTemplates();
    visitTemplates( '/templates/announcement' );
    let sends = 0;
    cy.intercept( 'POST', `${ API }/templates/send-to-customers`, ( req ) => {
      sends += 1;
      req.reply( sends === 1 ?
        { success: true, sendId: req.body.sendId, queued: 2, total: 2, left: 1, lastAt: '2026-11-09T17:00:00.000Z', failed: 0 } :
        { success: true, sendId: req.body.sendId, queued: 1, total: 3, left: 0, lastAt: '2026-11-09T17:00:15.000Z', failed: 0 } );
    } ).as( 'sendCustomers' );
    cy.get( '[data-cy=template-next]' ).click();
    cy.get( '[data-cy=target-customers]' ).should( 'contain', 'Your Store customers' ).and( 'contain', '3 customers who asked for your emails' ).click();
    cy.get( '[data-cy=customers-line]' ).should( 'contain', 'asked for news and offers from Fernwood Coffee at checkout' ).and( 'contain', 'unsubscribe link' );
    cy.get( '[data-cy=customers-send]' ).should( 'contain', 'Send to 3 customers' ).click();
    cy.wait( '@sendCustomers' ).then( ( first ) => {
      expect( first.request.body ).to.include( { templateId: 'announcement' } );
      expect( first.request.body.sendId ).to.match( /^[A-Za-z0-9_-]{8,}$/ );
      cy.get( '[data-cy=customers-result]' ).should( 'contain', 'Queued for 2 customers' ).and( 'contain', '1 customer still to go' );
      cy.get( '[data-cy=customers-send]' ).should( 'contain', 'Send to the rest (1 customer)' ).click();
      // The same send: the backend skips the two already queued.
      cy.wait( '@sendCustomers' ).its( 'request.body.sendId' ).should( 'eq', first.request.body.sendId );
    } );
    cy.get( '[data-cy=customers-result]' ).should( 'contain', 'Queued for 3 customers' );
    cy.get( '[data-cy=customers-send]' ).should( 'not.exist' );
  } );

  it( 'from the Store\'s "Email your customers", Next goes straight to them, and says so when none have asked', () => {
    cy.intercept( 'GET', `${ API }/templates/customers`, { success: true, count: 0, stores: [], canSend: true } ).as( 'customers' );
    stubTemplates();
    visitTemplates( '/templates?to=customers' );
    cy.get( '[data-cy=template-newsletter]' ).click();
    cy.location( 'search' ).should( 'include', 'to=customers' );
    cy.get( '[data-cy=template-next]' ).click();
    cy.get( '[data-cy=target-customers]' ).should( 'have.class', 'on' ).and( 'contain', 'None have asked for emails yet' );
    cy.get( '[data-cy=customers-line]' ).should( 'contain', 'Email me news and offers' );
    cy.get( '[data-cy=customers-send]' ).should( 'not.exist' );
  } );

  it( 'says what the profile is missing before anything can send', () => {
    stubTemplates( ( c ) => ( { ...c, problems: [ { field: 'address', message: 'Add a mailing address in your profile. Marketing email must show one.' } ] } ) );
    visitTemplates( '/templates/newsletter' );
    cy.get( '[data-cy=brand-problems]' ).should( 'contain', 'mailing address' ).find( 'a' ).should( 'have.attr', 'href', 'https://app.16ahead.com/update-profile' );
  } );
} );
