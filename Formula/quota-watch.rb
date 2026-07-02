class QuotaWatch < Formula
  desc "AI subscription quota monitoring — track usage, predict exhaustion, get alerts"
  homepage "https://github.com/ele-yufo/quota-watch"
  url "https://registry.npmjs.org/@quota-watch/cli/-/cli-0.1.0.tgz"
  sha256 "PLACEHOLDER"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/quota-watch", "--version"
  end
end
