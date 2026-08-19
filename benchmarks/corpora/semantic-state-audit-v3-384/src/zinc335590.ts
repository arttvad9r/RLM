export class Ember071Local2 {
  ledger = [] as string[]

  invokeChange() {
    this.ledger = this.ledger.concat("x")
  }
}
