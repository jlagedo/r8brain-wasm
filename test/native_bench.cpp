/**
 * Native baseline benchmark for r8brain-free-src.
 *
 * Built with the SAME config as the WASM module (build.sh): -O3 -flto,
 * R8B_FASTTIMING=1, R8B_EXTFFT left at the library default (0). Reports:
 *   - latency (getInputRequiredForOutput(1)) per rate pair + transBand sweep,
 *     to confirm the WASM build matches native exactly (it should: latency is
 *     algorithmic, not platform-dependent);
 *   - throughput (Msamples/s and realtime factor) so we know the native ceiling
 *     and, by comparison with the same workload in Node, the WASM overhead.
 *
 * Compile (from repo root):
 *   g++ -std=c++17 -O3 -flto -msse2 -DR8B_FASTTIMING=1 \
 *       test/native_bench.cpp -o /tmp/native_bench -lm
 */

#include <cstdio>
#include <cmath>
#include <chrono>
#include <vector>
#include "../vendor/r8brain-free-src/CDSPResampler.h"

using namespace r8b;
using clk = std::chrono::steady_clock;

static const double PI = 3.14159265358979323846;

struct Pair { double src, dst; };

int main()
{
    const Pair pairs[] = { {22050,48000}, {24000,48000}, {44100,48000} };
    const int MAXIN = 1024;

    printf("# Native r8brain (CDSPResampler24, transBand 2.0)\n");
    printf("rate pair        latency(in / ms)   throughput        realtime x\n");
    for (const Pair& p : pairs)
    {
        CDSPResampler24 rs(p.src, p.dst, MAXIN, 2.0);
        const int lat = rs.getInputRequiredForOutput(1);
        const double latms = lat / p.src * 1000.0;

        // Throughput: resample ~30 s of a 1 kHz tone, timed.
        const long totalIn = (long)(p.src * 30);
        std::vector<double> in(MAXIN);
        long fedIn = 0, gotOut = 0;
        // Warm up one block (filter design already done in ctor).
        const auto t0 = clk::now();
        for (long off = 0; off < totalIn; off += MAXIN)
        {
            const int len = (int)std::min((long)MAXIN, totalIn - off);
            for (int i = 0; i < len; i++)
                in[i] = sin(2 * PI * 1000.0 * (off + i) / p.src);
            double* op = 0;
            const int n = rs.process(&in[0], len, op);
            fedIn += len; gotOut += n;
        }
        const auto t1 = clk::now();
        const double sec = std::chrono::duration<double>(t1 - t0).count();
        const double outPerSec = gotOut / sec;          // output samples / s
        const double audioSec = (double)gotOut / p.dst; // seconds of output audio
        const double rtx = audioSec / sec;              // realtime factor

        printf("%6.0f -> %5.0f   %5d (%5.1f ms)   %6.1f Msmp/s     %8.0fx\n",
            p.src, p.dst, lat, latms, outPerSec / 1e6, rtx);
        (void)fedIn;
    }

    printf("\n# Latency vs transBand (22050 -> 48000, CDSPResampler24)\n");
    printf("transBand   latency(in / ms)\n");
    const double tbs[] = { 2.0, 3.0, 4.0, 6.0, 8.0, 10.0 };
    for (double tb : tbs)
    {
        CDSPResampler24 rs(22050, 48000, MAXIN, tb);
        const int lat = rs.getInputRequiredForOutput(1);
        printf("%5.1f       %5d (%5.1f ms)\n", tb, lat, lat / 22050.0 * 1000.0);
    }
    return 0;
}
