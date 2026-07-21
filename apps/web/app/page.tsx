import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import {
  CtaBanner,
  Features,
  HowItWorks,
  Partners,
  StatsBar,
  Testimonials,
  WaysToEarn,
} from "@/components/landing/sections";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <div className="bg-white">
      <Navbar />
      <main>
        <Hero />
        <Partners />
        <Features />
        <HowItWorks />
        <WaysToEarn />
        <Testimonials />
        <StatsBar />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
