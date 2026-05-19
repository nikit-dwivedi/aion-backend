import { AnalyticsRepository } from './analytics.repository.js';

export class AnalyticsService {
  static async getFocusAnalytics(userId: string) {
    const hourlyResult = await AnalyticsRepository.getHourlyDistribution(userId);
    const dowResult = await AnalyticsRepository.getDowDistribution(userId);
    const streakResult = await AnalyticsRepository.getDailyStreak(userId);
    const totalResult = await AnalyticsRepository.getTotalStats(userId);

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const row of streakResult.rows) {
      const d = new Date(row.d as string);
      d.setHours(0, 0, 0, 0);
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - streak);
      
      if (d.getTime() === expectedDate.getTime()) {
        streak++;
      } else if (streak === 0 && d.getTime() === new Date(today.getTime() - 86400000).getTime()) {
        streak = 1;
      } else {
        break;
      }
    }

    const hours = hourlyResult.rows as any[];
    const peakHour = hours.reduce((max, h) => (h.count > (max?.count ?? 0) ? h : max), null);
    const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dows = dowResult.rows as any[];
    const peakDow = dows.reduce((max, d) => (d.count > (max?.count ?? 0) ? d : max), null);

    return {
      hourlyDistribution: hours.map(h => ({ hour: Number(h.hour), count: h.count })),
      dayOfWeekDistribution: dows.map(d => ({ day: dowNames[Number(d.dow)], count: d.count })),
      currentStreak: streak,
      peakHour: peakHour ? Number(peakHour.hour) : null,
      peakDay: peakDow ? dowNames[Number(peakDow.dow)] : null,
      totalMemories: (totalResult.rows[0] as any)?.total_memories ?? 0,
      firstCapture: (totalResult.rows[0] as any)?.first_capture ?? null,
      lastCapture: (totalResult.rows[0] as any)?.last_capture ?? null,
    };
  }

  static async getBehavioralPatterns(userId: string) {
    const topProjects = await AnalyticsRepository.getTopProjects(userId);
    const topEntities = await AnalyticsRepository.getTopEntities(userId);
    const sentimentTrend = await AnalyticsRepository.getSentimentTrend(userId);
    const captureTrend = await AnalyticsRepository.getCaptureTrend(userId);
    const concerns = await AnalyticsRepository.getRecurringConcerns(userId);
    const people = await AnalyticsRepository.getPeople(userId);

    return {
      topProjects: topProjects.rows,
      topEntities: topEntities.rows,
      sentimentTrend: sentimentTrend.rows,
      captureTrend: captureTrend.rows,
      recurringConcerns: concerns.rows,
      people: people.rows,
    };
  }
}
