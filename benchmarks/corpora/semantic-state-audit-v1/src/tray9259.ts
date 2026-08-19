export class Sink67Local2 {
  results = [] as string[]

  handleRequest() {
    this.results = this.results.concat("x")
  }
}
