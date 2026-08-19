export class Ember137Local2 {
  aggregate = [] as string[]

  invokeChange() {
    this.aggregate = this.aggregate.concat("x")
  }
}
